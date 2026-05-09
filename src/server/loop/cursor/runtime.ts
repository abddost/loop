import { existsSync } from "node:fs"
import { ulid } from "@core/id"
import { filterCompacted } from "@core/message/compact"
import { looksLikeText, stripDataUrlPrefix } from "@core/message/data-url"
import type { MessageWithParts } from "@core/schema/message"
import type { FileDiff, FilePart, Part } from "@core/schema/part"
import type { PermissionRuleset } from "@core/schema/permission"
import { Deferred } from "@core/util/async"
import { AgentRegistry } from "../../agent"
import { insertReminders } from "../../agent/prompt/inject"
import { assembleSystemPrompt } from "../../agent/prompt/system"
import * as Database from "../../db"
import * as queries from "../../db/queries"
import { createLogger } from "../../logger"
import { pendingQuestions } from "../../loop/question"
import { writePlan } from "../../plan"
import { CURSOR_PROVIDER_ID, decodeVariantId } from "../../provider/handlers/cursor"
import { ProviderRegistry } from "../../provider/registry"
import { bus } from "../../workspace/bus"
import {
	COMPACTION_BUFFER,
	COMPACTION_RETRY_LIMIT,
	estimateMessageTokens,
	hasModelTurnSinceCompaction,
	needsCompaction,
	pruneToolOutputs,
	runCompaction,
} from "../compaction"
import type { PromptBody } from "../index"
import { markSessionErrorEmitted } from "../prompt"
import { snapshot } from "../snapshot"
import { setSessionStatus } from "../status"
import { ensureSessionTitle } from "../title"
import { resolveAssistantMessageId } from "../user-message"
import { AcpProtocolError, AcpTransportError } from "./acp/client"
import type { ContentBlock, PromptResponse, SessionMode } from "./acp/types"
import { type CursorPartEmitter, createCursorAdapter } from "./adapter"
import { makeRequestPermissionHandler } from "./permissions"
import { clearCursorResume, persistCursorResume, readCursorResumeState } from "./session"
import {
	type CursorRuntime,
	cancelCursorRuntime,
	closeCursorRuntime,
	ensureCursorRuntime,
} from "./session-runtime"
import { generateCursorTitle } from "./title"

/**
 * Cursor ACP runtime for Loop sessions.
 *
 * Each Loop session owns one ACP subprocess (`agent acp`) wrapped by an
 * `AcpClient`. A turn:
 *   1. Loads message history, runs `insertReminders` so plan-mode / build-
 *      switch / queued-message reminders are baked into the user prompt.
 *   2. Optionally summarises (compaction) when context is near the cap.
 *   3. Spawns or reuses the per-session ACP runtime, sets model and mode.
 *   4. Builds the ACP `prompt` payload from the last user message — text
 *      AND attachments (images via `image` blocks, text/code via `resource`
 *      blocks). Synthetic reminders sit in the same payload.
 *   5. Streams `session/update` notifications through the adapter.
 *   6. Maps the `PromptResponse.stopReason` to Loop's finish reason and
 *      handles the synthetic-handoff path used by plan_exit.
 */

const log = createLogger("cursor-runtime")

const MAX_SYNTHETIC_HANDOFF_DEPTH = 5

const DEFAULT_CURSOR_BINARY = "agent"
const CURSOR_AUTH_METHOD_ID = "cursor_login"
const CLIENT_INFO = { name: "loop", version: "0.1.0" } as const

/**
 * ACP mode aliases. Cursor exposes three semantic mode buckets:
 *   - PLAN: read-only planning ("plan", "architect")
 *   - IMPLEMENT: full tool access ("default", "build", "agent", "code", "chat", "implement")
 *   - APPROVAL: ask-before-each-action ("ask")
 *
 * "ask" must NOT be in the plan bucket — that's Cursor's runtime
 * permission mode, semantically distinct from planning.
 *
 * Mirrors t3code/apps/server/src/provider/Layers/CursorAdapter.ts:82-84.
 */
const ACP_PLAN_MODE_ALIASES = ["plan", "architect"] as const
const ACP_IMPLEMENT_MODE_ALIASES = [
	"code",
	"agent",
	"default",
	"chat",
	"implement",
	"build",
] as const
const ACP_APPROVAL_MODE_ALIASES = ["ask"] as const

export async function runCursorLoop(
	sessionId: string,
	signal: AbortSignal,
	body?: PromptBody,
	_handoffDepth = 0,
): Promise<void> {
	const session = queries.findSessionById(sessionId)
	if (!session) throw new Error(`Session not found: ${sessionId}`)

	const agentName = resolveAgentName(sessionId, body)
	const agent = AgentRegistry.get(agentName)
	if (!agent) throw new Error(`Agent not found: ${agentName}`)

	const modelRef = resolveCursorModel(sessionId, body)
	if (!modelRef) {
		throw new Error("Cursor turn missing a model reference. Pick a Cursor model before sending.")
	}

	const sessionRulesetRaw = (session as { permission?: unknown }).permission
	const sessionRuleset = Array.isArray(sessionRulesetRaw)
		? (sessionRulesetRaw as PermissionRuleset)
		: undefined
	const sessionPermissionMode = (session as { permissionMode?: string }).permissionMode

	// Compaction (pre-prompt). We do a soft check based on the previous
	// turn's usage stored in session metadata; if we're past the threshold
	// we summarise the conversation BEFORE sending the next prompt to ACP.
	// On success, message history gets the compaction boundary + a fresh
	// continuation prompt — extractFinalUserPrompt picks that up below.
	await maybeCompact(sessionId, modelRef, signal)

	const rawMessages = queries.findMessagesBySessionId(sessionId) as MessageWithParts[]
	const messages = filterCompacted(rawMessages)
	insertReminders({
		messages,
		agent,
		sessionId,
		providerKind: "cursor",
		...(sessionPermissionMode ? { sessionPermissionMode } : {}),
	})

	const lastUserMessage = findLastUserMessage(messages)
	if (!lastUserMessage) throw new Error("No user message found for Cursor turn")

	const userPrompt = extractUserPromptText(lastUserMessage)
	if (!userPrompt) throw new Error("No user prompt text found for Cursor turn")

	const resumeState = readCursorResumeState(sessionId)
	const cwd = resolveCwd(sessionId, session.directory, resumeState)
	const resumeAcpSessionId = resumeState.cursorAgentId ?? undefined

	const env = await buildSpawnEnv()

	const assistantMessageId = resolveAssistantMessageId(body)
	const assistantMeta = {
		modelId: modelRef.modelId,
		providerId: modelRef.providerId,
		agent: agentName,
	}
	Database.withEffects((_tx, effect) => {
		queries.createMessage({
			id: assistantMessageId,
			sessionId,
			role: "assistant",
			metadata: assistantMeta,
		})
		effect(() => {
			bus().emit("message:create", {
				sessionId,
				message: {
					id: assistantMessageId,
					sessionId,
					role: "assistant",
					metadata: assistantMeta,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					parts: [],
				},
			})
		})
	})

	setSessionStatus(sessionId, "busy")

	let preSnapshotHash: string | undefined
	try {
		const snapshotManager = await snapshot()
		preSnapshotHash = await snapshotManager.capture()
	} catch (err) {
		log.warn("Pre-turn snapshot failed", {
			sessionId,
			error: err instanceof Error ? err.message : String(err),
		})
	}

	const emitter = makePartEmitter(sessionId, assistantMessageId)
	let observedPlanWrite: { planPath: string; planContent: string } | undefined
	let forbiddenToolViolation:
		| {
				callId: string
				tool: string
				targetPath: string | undefined
				reason: string
		  }
		| undefined
	const planModeActiveFlag =
		agentName === "plan" || agentName === "explore" || sessionPermissionMode === "plan"
	const adapter = createCursorAdapter({
		emitter,
		loopSessionId: sessionId,
		planModeActive: planModeActiveFlag,
		onActive: () => {
			setSessionStatus(sessionId, "busy")
		},
		onUsageUpdate: (usage) => {
			try {
				const info = ProviderRegistry.getModelInfo(modelRef.providerId, modelRef.modelId)
				// `usage.size` from cursor is the live context window for the
				// active model — prefer the registry-known capacity but
				// fall through to the wire value so cursor's synthetic
				// provider (no registry entry) still gets a real number.
				const contextWindow = info?.contextWindow ?? usage.size ?? 0
				const inputTokens = usage.input ?? usage.used
				const outputTokens = usage.output ?? 0
				bus().emit("session:usage", {
					sessionId,
					usage: {
						input: inputTokens,
						output: outputTokens,
					},
					cost: usage.cost ?? 0,
					contextWindow,
				})
				// Persist tokens AND contextWindow on the assistant message so
				// `deriveSessionUsage` can rehydrate the UsageBar after a
				// reload — without `contextWindow` in metadata, the
				// percentage computation divides by 0 and the bar reads as
				// blank. Mirrors the AI SDK loop's persistence in
				// stream-processor.ts.
				const existing = queries
					.findMessagesBySessionId(sessionId)
					.find((m) => m.id === assistantMessageId)
				const existingMeta = (existing?.metadata as Record<string, unknown> | undefined) ?? {}
				queries.updateMessage(assistantMessageId, {
					metadata: {
						...existingMeta,
						...assistantMeta,
						tokens: { input: inputTokens, output: outputTokens },
						...(usage.cost !== undefined ? { cost: usage.cost } : {}),
						...(contextWindow > 0 ? { contextWindow } : {}),
					},
				})
			} catch (err) {
				log.warn("Failed to emit session:usage", {
					sessionId,
					error: err instanceof Error ? err.message : String(err),
				})
			}
		},
		onModeChange: (modeId) => {
			log.info("ACP mode change", { sessionId, modeId })
		},
		onPlanWritten: (info) => {
			observedPlanWrite = info
		},
		onForbiddenTool: (info) => {
			// Defense 4: cursor attempted a forbidden tool while plan mode is
			// active AND didn't go through `session/request_permission` (so
			// the permissions.ts hard-reject couldn't intervene). The
			// adapter has already marked the tool as failed; here we cancel
			// the rest of the turn so cursor stops further damage and the
			// user gets a clear stop signal.
			if (forbiddenToolViolation) return
			forbiddenToolViolation = {
				callId: info.callId,
				tool: info.tool,
				targetPath: info.targetPath,
				reason: info.reason,
			}
			log.warn("Cancelling cursor turn due to plan-mode tool violation", {
				sessionId,
				...forbiddenToolViolation,
			})
			emitSessionError(
				sessionId,
				"warning",
				"tool",
				`Plan mode forbids ${info.reason}. Turn cancelled.`,
			)
			try {
				cancelCursorRuntime(sessionId)
			} catch (err) {
				log.warn("cancelCursorRuntime threw on forbidden-tool detection", {
					sessionId,
					error: err instanceof Error ? err.message : String(err),
				})
			}
		},
	})
	adapter.beginTurn(preSnapshotHash)

	let runtimeError: Error | undefined
	let promptResponse: PromptResponse | undefined
	let abortHandler: (() => void) | undefined
	let finishOverride: string | undefined
	// Hoisted so finalizeTurn (outside the main try) can pass the
	// system-prompt char count into the token-estimation fallback.
	let systemPromptText: string | undefined

	try {
		const runtime = await ensureCursorRuntime({
			loopSessionId: sessionId,
			cwd,
			spawn: { command: DEFAULT_CURSOR_BINARY, env },
			authMethodId: CURSOR_AUTH_METHOD_ID,
			clientInfo: CLIENT_INFO,
			...(resumeAcpSessionId ? { resumeAcpSessionId } : {}),
			clientCapabilities: {
				_meta: { parameterizedModelPicker: true },
			},
		})

		if (runtime.acpSessionId !== resumeState.cursorAgentId) {
			persistCursorResume(sessionId, {
				cursorAgentId: runtime.acpSessionId,
				cursorCwd: cwd,
			})
		}

		// Wire handlers BEFORE prompt so notifications during the prompt are delivered.
		runtime.client.onSessionUpdate((notif) => adapter.handle(notif))

		const userPermissionHandler = makeRequestPermissionHandler({
			loopSessionId: sessionId,
			signal,
			agentPermission: agent.permission,
			agentName,
			...(sessionPermissionMode ? { sessionPermissionMode } : {}),
			...(sessionRuleset ? { sessionRuleset } : {}),
		})
		runtime.client.onRequestPermission(async (req) => {
			// Plan-mode hard guard runs FIRST so full-access never bypasses
			// the plan-mode constraint. Plan mode is active when EITHER
			// the agent is `plan`/`explore` OR the session permission mode
			// is set to `plan` (UI toggle).
			const isPlanModeActive =
				agentName === "plan" || agentName === "explore" || sessionPermissionMode === "plan"
			// Auto-approve when the workspace is in full-access mode AND
			// plan mode isn't active. Mirrors t3code's
			// `selectAutoApprovedPermissionOption` — picks the strongest
			// "allow" option Cursor offers without prompting.
			if (sessionPermissionMode === "full-access" && !isPlanModeActive) {
				const optionId = pickAutoApprovalOptionId(req.options)
				if (optionId) {
					return { outcome: { outcome: "selected", optionId } }
				}
			}
			return userPermissionHandler(req)
		})

		// Cursor's `cursor/create_plan` extension: persist the plan to disk
		// (so BUILD_SWITCH reminder picks it up) and synthesize a plan-write
		// tool part so PlanCard renders. The runtime triggers the approval
		// flow at end-of-turn regardless of whether the plan came in via
		// CreatePlan, an Edit, or this extension.
		runtime.client.onExtensionRequest("cursor/create_plan", async (params) => {
			try {
				const planMd = extractCursorPlanMarkdown(params)
				if (planMd && planMd.trim().length > 0) {
					const path = writePlan(sessionId, planMd)
					adapter.injectExternalPlanWrite({ planPath: path, planContent: planMd })
				}
			} catch (err) {
				log.warn("cursor/create_plan handler threw", {
					sessionId,
					error: err instanceof Error ? err.message : String(err),
				})
			}
			return { accepted: true }
		})
		runtime.client.onExtensionRequest("cursor/update_todos", async (params) => {
			// Cursor sends the actual todo items through this dedicated
			// extension RPC channel. The mirror `tool_call` event has
			// empty `rawInput.todos` on most cursor versions (the tool
			// is a stub), so without injecting from here the work-log
			// shows "Todo: 0 tasks" for every UpdateTodos call.
			try {
				const extracted = extractCursorUpdateTodos(params)
				if (extracted) {
					adapter.injectExternalTodoWrite({
						todos: extracted.todos,
						...(extracted.merge !== undefined ? { merge: extracted.merge } : {}),
					})
				}
			} catch (err) {
				log.warn("cursor/update_todos handler threw", {
					sessionId,
					error: err instanceof Error ? err.message : String(err),
				})
			}
			return {}
		})

		// `cursor/ask_question` — Cursor's interactive question channel. We
		// route through Loop's existing question:request bus + question route
		// so the user sees the same UI as built-in Loop questions.
		runtime.client.onExtensionRequest("cursor/ask_question", async (params) =>
			handleCursorAskQuestion({ sessionId, params, signal }),
		)

		// Re-apply model + mode on EVERY turn — Cursor's runtime is reused
		// across turns within a session, so an agent switch (plan ↔ build,
		// per the synthetic-handoff path) needs the mode reset BEFORE the
		// next prompt. Mirrors t3code's `applyRequestedSessionConfiguration`
		// which it calls at the start of every sendTurn.
		await applyModelSelection(runtime, modelRef.modelId)
		await applyMode(runtime, {
			agentName,
			sessionPermissionMode,
		})

		if (signal.aborted) {
			cancelCursorRuntime(sessionId)
		} else {
			abortHandler = () => {
				log.info("Aborting Cursor turn", { sessionId })
				cancelCursorRuntime(sessionId)
			}
			signal.addEventListener("abort", abortHandler, { once: true })
		}

		// Assemble the proper system prompt via Loop's main prompt
		// pipeline. ACP doesn't have a `system` role, so we send the
		// result as a leading text block wrapped in `<system>` tags so
		// cursor's model treats it as authoritative — the same content
		// the AI SDK path sends as `role: "system"`.
		//
		// Plan-mode tool policy (allowed/forbidden tool list, exact plan
		// file path, turn-cancellation consequence) is included by
		// assembleSystemPrompt itself when `planModeActive` is true.
		// Build-switch block lands on the first build-mode turn after a
		// plan was approved.
		const wasPlan = messages.some(
			(m) =>
				m.role === "assistant" && (m.metadata as { agent?: string } | undefined)?.agent === "plan",
		)
		const buildSwitchActive = wasPlan && agentName === "build"
		systemPromptText = await assembleSystemPrompt({
			agent,
			modelId: modelRef.modelId,
			sessionId,
			planModeActive: planModeActiveFlag,
			buildSwitchActive,
		})

		const promptBlocks = buildPromptBlocks({
			agent,
			userPrompt,
			attachments: collectAttachments(lastUserMessage),
			systemPrompt: systemPromptText,
		})

		runtime.promptInFlight = true
		try {
			promptResponse = await runtime.client.prompt({
				sessionId: runtime.acpSessionId,
				prompt: promptBlocks,
			})
		} finally {
			runtime.promptInFlight = false
		}

		// Cursor returns per-turn token counts in `PromptResponse.usage`
		// (input / output / reasoning / cacheRead / cacheWrite) — separately
		// from any streaming `usage_update` notifications. Capture both so
		// the UsageBar gets non-zero numbers even when cursor doesn't emit
		// `usage_update`. We merge the live `adapter.currentUsage` (which
		// has cursor's `size` for the context window) with the
		// promptResponse's per-turn split.
		const promptUsage = promptResponse.usage
		if (promptUsage) {
			try {
				const info = ProviderRegistry.getModelInfo(modelRef.providerId, modelRef.modelId)
				const live = adapter.currentUsage
				const contextWindow = info?.contextWindow ?? live?.size ?? 0
				const inputTokens =
					typeof promptUsage.input === "number"
						? promptUsage.input
						: (live?.input ?? live?.used ?? 0)
				const outputTokens =
					typeof promptUsage.output === "number" ? promptUsage.output : (live?.output ?? 0)
				const reasoningTokens =
					typeof promptUsage.reasoning === "number" ? promptUsage.reasoning : undefined
				const cacheRead =
					typeof promptUsage.cacheRead === "number" ? promptUsage.cacheRead : undefined
				const cacheWrite =
					typeof promptUsage.cacheWrite === "number" ? promptUsage.cacheWrite : undefined
				const cost = live?.cost ?? 0
				if (contextWindow && (inputTokens > 0 || outputTokens > 0)) {
					bus().emit("session:usage", {
						sessionId,
						usage: {
							input: inputTokens,
							output: outputTokens,
							...(reasoningTokens !== undefined ? { reasoning: reasoningTokens } : {}),
							...(cacheRead !== undefined ? { cacheRead } : {}),
							...(cacheWrite !== undefined ? { cacheWrite } : {}),
						},
						cost,
						contextWindow,
					})
					// Persist for the reload path (deriveSessionUsage) and so
					// finalizeTurn doesn't overwrite the values we just resolved.
					const existing = queries
						.findMessagesBySessionId(sessionId)
						.find((m) => m.id === assistantMessageId)
					const existingMeta = (existing?.metadata as Record<string, unknown> | undefined) ?? {}
					queries.updateMessage(assistantMessageId, {
						metadata: {
							...existingMeta,
							...assistantMeta,
							tokens: {
								input: inputTokens,
								output: outputTokens,
								...(reasoningTokens !== undefined ? { reasoning: reasoningTokens } : {}),
								...(cacheRead !== undefined ? { cacheRead } : {}),
								...(cacheWrite !== undefined ? { cacheWrite } : {}),
							},
							cost,
							contextWindow,
						},
					})
				}
			} catch (err) {
				log.warn("Failed to broadcast PromptResponse usage", {
					sessionId,
					error: err instanceof Error ? err.message : String(err),
				})
			}
		}

		switch (promptResponse.stopReason) {
			case "cancelled":
				finishOverride = "abort"
				break
			case "max_tokens":
			case "max_turn_requests":
				finishOverride = "length"
				break
			case "refusal":
				finishOverride = "refusal"
				break
			default:
				finishOverride = undefined
		}
	} catch (err) {
		runtimeError = err instanceof Error ? err : new Error(String(err))
		if (!signal.aborted) {
			const category = categorizeCursorError(runtimeError)
			log.error("Cursor runtime error", {
				sessionId,
				category: category.kind,
				error: runtimeError.message,
			})
			emitSessionError(
				sessionId,
				"error",
				category.source,
				category.userMessage ?? runtimeError.message,
				runtimeError.stack,
				category.recoverable,
			)
			markSessionErrorEmitted(runtimeError)
			persistErrorAsPart(sessionId, assistantMessageId, runtimeError)
			finishOverride = "error"
			if (
				category.kind === "auth" ||
				category.kind === "transport" ||
				category.kind === "binary-not-found"
			) {
				clearCursorResume(sessionId)
				await closeCursorRuntime(sessionId)
			}
		} else {
			finishOverride = "abort"
		}
	} finally {
		if (abortHandler) signal.removeEventListener("abort", abortHandler)
	}

	// If a forbidden plan-mode tool was detected, force the turn to end
	// in `abort` state regardless of cursor's reported stopReason —
	// cursor's stopReason might still be "stop" even though we cancelled
	// the underlying session.
	const finalFinishOverride = forbiddenToolViolation
		? "abort"
		: signal.aborted
			? "abort"
			: finishOverride
	await finalizeTurn({
		sessionId,
		messageId: assistantMessageId,
		agentName,
		modelRef,
		preSnapshotHash,
		adapterFinalize: adapter.finalize.bind(adapter),
		adapterCurrentUsage: () => adapter.currentUsage,
		overrideFinish: finalFinishOverride,
		systemPromptChars: systemPromptText?.length ?? 0,
		titleSpawn: {
			command: DEFAULT_CURSOR_BINARY,
			cwd,
			env,
		},
	})

	// Plan-approval gate (Cursor-specific): the plan agent doesn't have
	// access to Loop's plan_exit tool because Cursor runs its own tool
	// registry. So we synthesize the approval at end-of-turn whenever
	// plan mode was active AND the agent wrote the plan file this turn
	// (via Edit, Write, CreatePlan, or cursor/create_plan extension).
	// Plan mode is signaled by EITHER the agent identity (`plan`) OR the
	// session permission mode (`plan` toggle in the input bar).
	//
	// On approval we synthesize a build-switch user message — the
	// existing handoff check picks it up and recurses into the build agent.
	const planApprovalActive =
		(agentName === "plan" || sessionPermissionMode === "plan") && observedPlanWrite !== undefined
	if (
		!signal.aborted &&
		!runtimeError &&
		planApprovalActive &&
		observedPlanWrite &&
		_handoffDepth < MAX_SYNTHETIC_HANDOFF_DEPTH
	) {
		// Synthesize a `plan-exit` tool Part on the assistant message so
		// the UI's PlanExitToolCall picks it up and renders the PlanCard +
		// PlanApproval — mirroring the Claude Code path where the
		// plan_exit tool itself emits this Part. The PlanApproval
		// component reads `pendingQuestions` for the answer mechanism;
		// askPlanApproval below emits the matching question.
		synthesizePlanExitPart({
			sessionId,
			messageId: assistantMessageId,
			planPath: observedPlanWrite.planPath,
			planContent: observedPlanWrite.planContent,
		})

		const approval = await askPlanApproval({
			sessionId,
			planPath: observedPlanWrite.planPath,
			planContent: observedPlanWrite.planContent,
			signal,
		})
		// Mark the plan-exit tool Part as completed so PlanApproval hides
		// after the user answers (it gates on `isActive(part)`).
		finalizePlanExitPart({
			sessionId,
			messageId: assistantMessageId,
			planPath: observedPlanWrite.planPath,
			planContent: observedPlanWrite.planContent,
		})

		if (approval.kind === "approve") {
			createPlanSyntheticUserMessage({
				sessionId,
				agent: "build",
				text: `The plan at ${observedPlanWrite.planPath} has been approved. Execute the plan.`,
			})
		} else if (approval.kind === "feedback") {
			createPlanSyntheticUserMessage({
				sessionId,
				agent: "plan",
				text: `Plan revision requested. User feedback: ${approval.feedback}\n\nUpdate the plan at ${observedPlanWrite.planPath} accordingly.`,
			})
		}
		// "cancelled" / abort → no synthetic message; nothing to hand off.
	}

	if (runtimeError && !signal.aborted) throw runtimeError

	if (signal.aborted || _handoffDepth >= MAX_SYNTHETIC_HANDOFF_DEPTH) return
	const updated = queries.findMessagesBySessionId(sessionId)
	const latest = updated[updated.length - 1]
	if (
		latest &&
		latest.role === "user" &&
		(latest.metadata as { synthetic?: boolean } | undefined)?.synthetic
	) {
		log.info("Cursor synthetic-message handoff", {
			sessionId,
			fromAgent: agentName,
			depth: _handoffDepth + 1,
		})
		// Clear messageId / assistantMessageId in the recursive body —
		// the original IDs already wrote rows for the plan turn. Reusing
		// them on the build turn would hit `UNIQUE constraint failed:
		// message.id`. The handoff turn must generate fresh IDs.
		const handoffBody: PromptBody | undefined = body
			? { ...body, messageId: undefined, assistantMessageId: undefined }
			: undefined
		await runCursorLoop(sessionId, signal, handoffBody, _handoffDepth + 1)
	}
}

// ─── Compaction ───────────────────────────────────────────────────────

/**
 * Pre-prompt compaction check. Reuses Loop's main `runCompaction` so the
 * conversation history shape stays compatible across providers (the
 * compaction Part is the same boundary marker).
 *
 * Cursor sessions don't have AI-SDK style usage reporting per turn — the
 * adapter persists `tokens` on the assistant message via `usage_update`,
 * and we read the most recent assistant's tokens here. If usage is unknown
 * we fall back to a char-based estimate so very long sessions still
 * compact even on the first run.
 */
async function maybeCompact(
	sessionId: string,
	modelRef: { modelId: string; providerId: string },
	signal: AbortSignal,
): Promise<void> {
	const info = ProviderRegistry.getModelInfo(modelRef.providerId, modelRef.modelId)
	const contextWindow = info?.contextWindow ?? 0
	if (contextWindow === 0) return

	const messages = queries.findMessagesBySessionId(sessionId) as MessageWithParts[]
	if (!hasModelTurnSinceCompaction(messages)) return

	const lastUsage = lastAssistantUsage(messages)
	const reported = lastUsage?.input ?? 0
	const fallback = estimateMessageTokens(messages)
	const totalTokens = Math.max(reported, fallback)
	const maxOutput = Math.min(info?.maxOutput ?? COMPACTION_BUFFER, contextWindow / 2)

	if (!needsCompaction(totalTokens, contextWindow, maxOutput)) return

	log.info("Cursor compaction triggered", {
		sessionId,
		totalTokens,
		contextWindow,
		maxOutput,
	})

	let attempt = 0
	while (attempt < COMPACTION_RETRY_LIMIT) {
		attempt++
		setSessionStatus(sessionId, "compacting")
		await pruneToolOutputs(sessionId)
		const filteredMessages = filterCompacted(
			queries.findMessagesBySessionId(sessionId) as MessageWithParts[],
		)
		const summary = await runCompactionSummary(filteredMessages, signal)
		if (signal.aborted) return
		if (!summary.trim()) {
			log.warn("Empty compaction summary, retrying", { sessionId, attempt })
			continue
		}
		const result = await runCompaction({
			sessionId,
			messages: filteredMessages,
			summary,
			signal,
			overflow: false,
		})
		if (result.success) {
			log.info("Compaction completed", { sessionId, attempt })
			return
		}
	}
	log.warn("Compaction retry budget exhausted", { sessionId })
}

/**
 * Cursor doesn't expose a separate "summarise this" RPC and we don't want
 * to spawn a *second* ACP process just for compaction. Instead we ask the
 * configured compaction agent's model directly via Loop's main provider
 * registry. Falls back to a deterministic structural summary if no model
 * resolves (offline / misconfigured).
 */
async function runCompactionSummary(
	messages: MessageWithParts[],
	signal: AbortSignal,
): Promise<string> {
	const compactionAgent = AgentRegistry.get("compaction")
	if (!compactionAgent?.model) return buildStructuralSummary(messages)
	try {
		const resolved = await ProviderRegistry.resolveModel(
			compactionAgent.model.providerId,
			compactionAgent.model.modelId,
		)
		if (!resolved) return buildStructuralSummary(messages)
		const { streamText } = await import("ai")
		const transcript = transcriptFromMessages(messages)
		const sys = compactionAgent.prompt ?? ""
		const stream = await streamText({
			model: resolved.instance,
			system: sys,
			messages: [{ role: "user", content: transcript }],
			abortSignal: signal,
			temperature: 0,
		})
		let out = ""
		for await (const chunk of stream.fullStream) {
			if (signal.aborted) break
			if (chunk.type === "text-delta") out += chunk.text
		}
		const m = out.match(/<summary>([\s\S]*?)<\/summary>/i)
		if (m) return m[1].trim()
		return out.trim() || buildStructuralSummary(messages)
	} catch (err) {
		log.warn("Compaction stream failed; using structural summary", {
			error: err instanceof Error ? err.message : String(err),
		})
		return buildStructuralSummary(messages)
	}
}

function transcriptFromMessages(messages: MessageWithParts[]): string {
	const lines: string[] = []
	for (const m of messages) {
		const text = m.parts
			.filter((p) => p.type === "text")
			.map((p) => ("text" in p && typeof p.text === "string" ? p.text : ""))
			.filter(Boolean)
			.join("\n")
		if (!text) continue
		lines.push(`### ${m.role}`)
		lines.push(text)
	}
	return [
		"Summarise the following conversation. Output a `<summary>` block.",
		"Preserve the user's intent, files touched, decisions, and any open questions.",
		"",
		lines.join("\n\n"),
	].join("\n")
}

/** Last-resort summariser when no compaction model is configured. */
function buildStructuralSummary(messages: MessageWithParts[]): string {
	const userMessages = messages
		.filter((m) => m.role === "user")
		.map((m) =>
			m.parts
				.filter((p) => p.type === "text")
				.map((p) => ("text" in p && typeof p.text === "string" ? p.text.slice(0, 200) : ""))
				.join(" "),
		)
		.filter(Boolean)
	const recentUser = userMessages.slice(-5).join("\n- ")
	const tools = new Set<string>()
	for (const m of messages) {
		for (const p of m.parts) {
			if (p.type === "tool" && typeof (p as { tool?: string }).tool === "string") {
				tools.add((p as { tool: string }).tool)
			}
		}
	}
	return [
		"<summary>",
		"Conversation context summary:",
		"",
		"## Recent user requests",
		`- ${recentUser}`,
		"",
		"## Tools used",
		Array.from(tools).join(", ") || "(none)",
		"</summary>",
	].join("\n")
}

function lastAssistantUsage(messages: MessageWithParts[]):
	| {
			input?: number
			output?: number
	  }
	| undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]
		if (m.role !== "assistant") continue
		const meta = m.metadata as { tokens?: { input?: number; output?: number } } | undefined
		if (meta?.tokens) return meta.tokens
	}
	return undefined
}

// ─── Mode + model wiring ──────────────────────────────────────────────

/**
 * Resolve which ACP mode id to ask Cursor for, based on Loop's agent +
 * permission mode. Mirrors t3code's `resolveRequestedModeId`:
 *   - plan agent  → ACP plan mode (read-only)
 *   - approval-required permission mode → ACP `ask` mode (per-action prompts)
 *   - everything else → ACP implement mode (full tool access)
 *
 * Falls back across alias buckets when a particular alias isn't advertised.
 *
 * Exported for unit-testing without a live ACP runtime.
 */
export function _resolveRequestedAcpModeForTesting(args: {
	agentName: string
	sessionPermissionMode: string | undefined
	available: ReadonlyArray<SessionMode>
}): SessionMode | undefined {
	return resolveRequestedAcpMode(args)
}

function resolveRequestedAcpMode(args: {
	agentName: string
	sessionPermissionMode: string | undefined
	available: ReadonlyArray<SessionMode>
}): SessionMode | undefined {
	const { agentName, sessionPermissionMode, available } = args
	if (available.length === 0) return undefined

	// Plan mode is triggered by EITHER:
	// - The agent identity (`plan` / `explore`) — primary signal
	// - The session permission mode (`plan`) — set via the input-bar
	//   selector. Without this, choosing "Plan mode" in the UI for a
	//   cursor session would be a no-op because cursor's plan-mode
	//   resolver only checked agentName.
	const planByAgent = agentName === "plan" || agentName === "explore"
	const planByPermissionMode = sessionPermissionMode === "plan"
	if (planByAgent || planByPermissionMode) {
		return findModeByAliases(available, ACP_PLAN_MODE_ALIASES)
	}
	if (sessionPermissionMode === "approval-required" || sessionPermissionMode === "custom") {
		return (
			findModeByAliases(available, ACP_APPROVAL_MODE_ALIASES) ??
			findModeByAliases(available, ACP_IMPLEMENT_MODE_ALIASES) ??
			available.find((m) => !isPlanMode(m))
		)
	}
	return (
		findModeByAliases(available, ACP_IMPLEMENT_MODE_ALIASES) ??
		findModeByAliases(available, ACP_APPROVAL_MODE_ALIASES) ??
		available.find((m) => !isPlanMode(m))
	)
}

function isPlanMode(mode: SessionMode): boolean {
	return findModeByAliases([mode], ACP_PLAN_MODE_ALIASES) !== undefined
}

function normaliseModeText(mode: SessionMode): string {
	return [mode.id, mode.displayName ?? "", mode.description ?? ""]
		.filter((s): s is string => typeof s === "string" && s.length > 0)
		.join(" ")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
}

function findModeByAliases(
	modes: ReadonlyArray<SessionMode>,
	aliases: ReadonlyArray<string>,
): SessionMode | undefined {
	const normalised = aliases.map((a) => a.toLowerCase())
	for (const alias of normalised) {
		const exact = modes.find(
			(m) =>
				m.id.toLowerCase() === alias ||
				(typeof m.displayName === "string" && m.displayName.toLowerCase() === alias),
		)
		if (exact) return exact
	}
	for (const alias of normalised) {
		const partial = modes.find((m) => normaliseModeText(m).includes(alias))
		if (partial) return partial
	}
	return undefined
}

async function applyMode(
	runtime: CursorRuntime,
	args: { agentName: string; sessionPermissionMode: string | undefined },
): Promise<void> {
	if (!runtime.modeState) return
	const target = resolveRequestedAcpMode({
		agentName: args.agentName,
		sessionPermissionMode: args.sessionPermissionMode,
		available: runtime.modeState.availableModes,
	})
	if (!target) {
		log.debug("No matching ACP mode for agent", {
			agentName: args.agentName,
			sessionPermissionMode: args.sessionPermissionMode,
			available: runtime.modeState.availableModes.map((m) => m.id),
		})
		return
	}
	if (runtime.modeState.currentModeId === target.id) return
	try {
		await runtime.client.setMode({ sessionId: runtime.acpSessionId, modeId: target.id })
		runtime.modeState = { ...runtime.modeState, currentModeId: target.id }
		log.info("ACP mode applied", {
			agentName: args.agentName,
			sessionPermissionMode: args.sessionPermissionMode,
			modeId: target.id,
		})
	} catch (err) {
		log.warn("session/set_mode failed", {
			modeId: target.id,
			error: err instanceof Error ? err.message : String(err),
		})
	}
}

async function applyModelSelection(runtime: CursorRuntime, modelId: string): Promise<void> {
	const decoded = decodeVariantId(modelId)
	const baseId = decoded.baseId.endsWith("-fast")
		? decoded.baseId.slice(0, -"-fast".length)
		: decoded.baseId

	const modelConfigId = pickModelConfigId(runtime.configOptions) ?? "model"

	try {
		const res = await runtime.client.setConfigOption({
			sessionId: runtime.acpSessionId,
			configId: modelConfigId,
			value: baseId,
		})
		if (res.configOptions) runtime.configOptions = res.configOptions
		runtime.currentModelId = baseId
	} catch (err) {
		log.warn("set_config_option(model) failed", {
			sessionId: runtime.loopSessionId,
			error: err instanceof Error ? err.message : String(err),
		})
		throw err
	}

	for (const param of decoded.params) {
		try {
			const res = await runtime.client.setConfigOption({
				sessionId: runtime.acpSessionId,
				configId: param.id,
				value: param.value,
			})
			if (res.configOptions) runtime.configOptions = res.configOptions
		} catch (err) {
			log.warn("set_config_option(param) failed", {
				sessionId: runtime.loopSessionId,
				configId: param.id,
				value: param.value,
				error: err instanceof Error ? err.message : String(err),
			})
		}
	}
}

function pickModelConfigId(
	options: ReadonlyArray<{ id: string; category?: string | null }>,
): string | undefined {
	for (const o of options) {
		if (o.category === "model") return o.id
	}
	return undefined
}

// ─── Prompt assembly (text + multimodal) ─────────────────────────────

/**
 * Build the ACP prompt content blocks.
 *
 * ACP has no `system` role on `prompt`, so we send Loop's full system
 * prompt (as assembled by `assembleSystemPrompt`) as the FIRST text
 * block, wrapped in `<system>` tags so cursor's model treats it as
 * authoritative — the same content the AI SDK path sends as
 * `role: "system"`. The system block carries the plan-mode tool
 * policy (allowed/forbidden tools, exact plan file path, turn-
 * cancellation consequence) when plan mode is active.
 *
 * The user prompt follows as a separate block. Attachments come last.
 *
 * Synthetic reminders from `insertReminders` are still merged into
 * the user prompt as belt-and-suspenders defense — they reinforce the
 * system block at the end of the conversation where the model's
 * attention is freshest.
 */
function buildPromptBlocks(args: {
	agent: { name: string; prompt?: string }
	userPrompt: string
	attachments: ReadonlyArray<FilePart>
	systemPrompt?: string
}): ContentBlock[] {
	const blocks: ContentBlock[] = []

	const sysTrimmed = args.systemPrompt?.trim()
	if (sysTrimmed && sysTrimmed.length > 0) {
		blocks.push({
			type: "text",
			text: `<system>\n${sysTrimmed}\n</system>`,
		})
	}

	const trimmed = args.userPrompt.trim()
	if (trimmed.length > 0) blocks.push({ type: "text", text: trimmed })

	for (const file of args.attachments) {
		const block = filePartToContentBlock(file)
		if (block) blocks.push(block)
	}

	return blocks
}

function filePartToContentBlock(file: FilePart): ContentBlock | undefined {
	const mime = file.mimeType
	const content = file.content

	if (!content) return undefined

	if (mime === "application/x-directory") {
		return {
			type: "text",
			text: `[Directory attached: ${file.path}]\n${content.slice(0, 4000)}`,
		}
	}

	if (mime.startsWith("image/")) {
		const data = stripDataUrlPrefix(content)
		return {
			type: "image",
			data,
			mimeType: mime,
		}
	}

	if (mime.startsWith("audio/")) {
		const data = stripDataUrlPrefix(content)
		return {
			type: "audio",
			data,
			mimeType: mime,
		}
	}

	// Text / code / pdf / json — embed as ACP `resource` block with text payload
	// when we have a plain string, or as a resource_link when we only have a path.
	const text = looksLikeText(content) ? stripDataUrlPrefix(content) : undefined
	if (text !== undefined) {
		return {
			type: "resource",
			resource: {
				uri: `file://${file.path}`,
				mimeType: mime || "text/plain",
				text,
			},
		}
	}

	// Binary blob fallback — link only, since ACP `resource` text is required
	// for embed-style display.
	return {
		type: "resource_link",
		uri: `file://${file.path}`,
		name: file.path.split("/").pop() ?? file.path,
		mimeType: mime,
	}
}

function collectAttachments(message: MessageWithParts): ReadonlyArray<FilePart> {
	const out: FilePart[] = []
	for (const p of message.parts) {
		if (p.type === "file") out.push(p as FilePart)
	}
	return out
}

function extractUserPromptText(message: MessageWithParts): string | undefined {
	const text = message.parts
		.filter((p) => p.type === "text")
		.map((p) => ("text" in p && typeof p.text === "string" ? p.text : ""))
		.filter((t) => t.length > 0)
		.join("\n\n")
		.trim()
	return text.length > 0 ? text : undefined
}

/** Rough chars-per-token ratio. Matches what most BPE tokenisers approximate. */
const CHARS_PER_TOKEN = 4

/**
 * Fixed overhead for cursor's own internal system prompt + tool registry
 * preamble. Cursor injects its own context-aware preamble that we never
 * see on the wire — without accounting for it, the estimation drastically
 * undercounts. 1500 tokens is conservative for cursor's typical preamble
 * (varies with tool registry size and active mode).
 */
const CURSOR_INTERNAL_OVERHEAD_TOKENS = 1500

/**
 * Estimate input/output token counts from full session content.
 *
 * Used as a fallback when cursor doesn't report usage via `usage_update`
 * or `PromptResponse.usage` — without this the UsageBar would either
 * show 0% (no signal) or undercount badly (only visible message text).
 *
 * Counts EVERY part type that actually contributes to cursor's context:
 *   - text parts (user/assistant)
 *   - reasoning blocks (assistant-side; thought tokens cursor billed)
 *   - tool inputs (JSON-stringified — args cursor's agent emitted)
 *   - tool outputs / errors (text the agent reads back into context)
 *   - tool metadata.diff strings (the unified-diff body cursor renders)
 *   - file attachments (content bytes)
 *
 * Plus the host system prompt (Loop's `assembleSystemPrompt` result, sent
 * as the leading `<system>` text block on every turn) and a fixed
 * overhead for cursor's own preamble we can't see directly.
 *
 * Cumulative across the session — matches cursor's `used` field semantics.
 * Roles split: user → input, assistant-generated content (text, reasoning,
 * tool args) → output, tool results / files → input (re-read next turn).
 */
function estimateTokensFromMessages(
	messages: Array<{
		role: string
		parts?: Array<{
			type?: string
			text?: string
			input?: unknown
			output?: string
			error?: string
			metadata?: Record<string, unknown>
			content?: string
		}>
	}>,
	systemPromptChars = 0,
): { input: number; output: number } {
	let inputChars = systemPromptChars + CURSOR_INTERNAL_OVERHEAD_TOKENS * CHARS_PER_TOKEN
	let outputChars = 0
	for (const msg of messages) {
		const parts = msg.parts ?? []
		for (const p of parts) {
			const isAssistant = msg.role === "assistant"
			if (p.type === "text" && typeof p.text === "string") {
				if (isAssistant) outputChars += p.text.length
				else inputChars += p.text.length
				continue
			}
			if (p.type === "reasoning" && typeof p.text === "string") {
				// Reasoning is generated by the agent — counts as output.
				outputChars += p.text.length
				continue
			}
			if (p.type === "tool") {
				// Tool inputs (args the agent supplied) → output (agent-generated).
				if (p.input !== undefined && p.input !== null) {
					try {
						outputChars += JSON.stringify(p.input).length
					} catch {
						// circular ref or other — skip
					}
				}
				// Tool outputs / error text → input on next turn's context.
				if (typeof p.output === "string") inputChars += p.output.length
				if (typeof p.error === "string") inputChars += p.error.length
				if (p.metadata && typeof p.metadata === "object") {
					const diff = (p.metadata as { diff?: unknown }).diff
					if (typeof diff === "string") inputChars += diff.length
				}
				continue
			}
			if (p.type === "file" && typeof p.content === "string") {
				// User-attached file content → input.
				inputChars += p.content.length
			}
		}
	}
	return {
		input: Math.ceil(inputChars / CHARS_PER_TOKEN),
		output: Math.ceil(outputChars / CHARS_PER_TOKEN),
	}
}

/**
 * Pull plain-text content from the first user message for title
 * generation. Mirrors `claude-code/runtime.ts:extractFirstUserText`.
 */
function extractFirstUserText(msg: {
	parts?: Array<{ type?: string; text?: string }>
}): string | undefined {
	const parts = msg.parts ?? []
	const text = parts
		.filter((p) => p.type === "text" && typeof p.text === "string")
		.map((p) => p.text ?? "")
		.join("\n")
		.trim()
	return text || undefined
}

function findLastUserMessage(messages: MessageWithParts[]): MessageWithParts | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "user") return messages[i]
	}
	return undefined
}

// ─── Spawn env ───────────────────────────────────────────────────────

async function buildSpawnEnv(): Promise<NodeJS.ProcessEnv> {
	const env: NodeJS.ProcessEnv = { ...process.env }
	try {
		const { resolveCursorApiKey } = await import("../../provider/handlers/cursor")
		const apiKey = await resolveCursorApiKey()
		if (apiKey && !env.CURSOR_API_KEY) env.CURSOR_API_KEY = apiKey
	} catch {
		// best-effort
	}
	return env
}

// ─── Error handling + finalize ───────────────────────────────────────

function emitSessionError(
	sessionId: string,
	severity: "error" | "warning",
	source: "runtime" | "auth" | "cli" | "rate-limit" | "tool" | "stream" | "provider",
	message: string,
	details?: string,
	recoverable?: boolean,
): void {
	try {
		bus().emit("session:error", {
			sessionId,
			error: { severity, source, message, details, recoverable },
		})
	} catch (err) {
		log.warn("Failed to emit session:error", {
			sessionId,
			error: err instanceof Error ? err.message : String(err),
		})
	}
}

function persistErrorAsPart(sessionId: string, messageId: string, err: unknown): void {
	const text = err instanceof Error ? err.message : String(err)
	const partId = ulid()
	Database.withEffects((_tx, effect) => {
		queries.upsertPart({
			id: partId,
			sessionId,
			messageId,
			type: "text",
			data: { type: "text", text: `Cursor runtime error: ${text}` },
		})
		effect(() => {
			bus().emit("part:upsert", {
				sessionId,
				messageId,
				part: { id: partId, type: "text", text: `Cursor runtime error: ${text}` },
			})
		})
	})
}

interface FinalizeArgs {
	sessionId: string
	messageId: string
	agentName: string
	modelRef: { modelId: string; providerId: string }
	preSnapshotHash: string | undefined
	adapterFinalize: (opts: {
		snapshotHash?: string
		editFiles?: Array<{
			path: string
			additions: number
			deletions: number
			status: "added" | "deleted" | "modified"
		}>
		finishReason?: string
	}) => { finishReason: string }
	overrideFinish: string | undefined
	/**
	 * Read the adapter's last-seen usage_update payload. Lets finalize
	 * persist `contextWindow` from cursor's wire `size` even when
	 * ProviderRegistry doesn't know cursor's synthetic model.
	 */
	adapterCurrentUsage?: () =>
		| { input?: number; output?: number; size: number; used: number; cost?: number }
		| undefined
	/**
	 * Char count of the system prompt sent to cursor this turn (Loop's
	 * `assembleSystemPrompt` result, wrapped in `<system>` tags). Fed
	 * into the token-estimation fallback so the UsageBar reflects
	 * actual context size — not just visible message text.
	 */
	systemPromptChars?: number
	/**
	 * Spawn descriptor for the one-shot title-generation cursor process.
	 * Same binary + cwd + env as the main session — but a separate ACP
	 * client so the title call doesn't disturb the live session.
	 */
	titleSpawn: {
		command: string
		cwd: string
		env: NodeJS.ProcessEnv
	}
}

async function finalizeTurn(args: FinalizeArgs): Promise<void> {
	const { sessionId, messageId, agentName, modelRef, preSnapshotHash } = args
	try {
		let postSnapshotHash: string | undefined
		let editFiles: Array<{
			path: string
			additions: number
			deletions: number
			status: "added" | "deleted" | "modified"
		}> = []
		try {
			const snapshotManager = await snapshot()
			postSnapshotHash = await snapshotManager.capture()
			if (preSnapshotHash && postSnapshotHash && preSnapshotHash !== postSnapshotHash) {
				const diffs: FileDiff[] = await snapshotManager.diffStats(preSnapshotHash, postSnapshotHash)
				editFiles = diffs.map((f) => ({
					path: f.path,
					additions: f.additions,
					deletions: f.deletions,
					status: f.status,
				}))
			}
		} catch (err) {
			log.warn("Post-turn snapshot failed", {
				sessionId,
				error: err instanceof Error ? err.message : String(err),
			})
		}

		let result: { finishReason: string } | undefined
		try {
			// IMPORTANT: pass the POST-step snapshot hash, not the pre-step.
			// `/sessions/:id/diff` walks step-start (pre) → step-finish
			// (post) and computes `diffFull(fromHash, toHash)`. If we put
			// preSnapshotHash on step-finish, fromHash === toHash and the
			// endpoint returns `[]` — which surfaces as "Diff unavailable
			// for this edit" in the UI. Mirrors the AI SDK main loop in
			// stream-processor.ts (uses `postHash` on step-finish parts).
			result = args.adapterFinalize({
				...(postSnapshotHash ? { snapshotHash: postSnapshotHash } : {}),
				editFiles,
				...(args.overrideFinish ? { finishReason: args.overrideFinish } : {}),
			})
		} catch (err) {
			log.warn("Cursor adapter finalize threw", {
				sessionId,
				error: err instanceof Error ? err.message : String(err),
			})
		}

		try {
			const info = ProviderRegistry.getModelInfo(modelRef.providerId, modelRef.modelId)
			// Preserve any tokens already persisted by usage_update.
			const allMessages = queries.findMessagesBySessionId(sessionId)
			const existing = allMessages.find((m) => m.id === messageId)
			const existingMeta = (existing?.metadata as Record<string, unknown> | undefined) ?? {}
			// Resolve the context-window value with priority:
			//   registry (Loop's known capacity) →
			//   already-persisted value from a usage_update earlier this turn →
			//   the live usage payload from the adapter (cursor's wire size) →
			//   a sane default (200k — matches Claude Sonnet, the most
			//   common cursor backend) so the UsageBar can at least
			//   render a meaningful percentage when cursor doesn't
			//   advertise a context window.
			const persistedContextWindow =
				typeof existingMeta.contextWindow === "number" ? existingMeta.contextWindow : undefined
			const liveUsage = args.adapterCurrentUsage?.()
			const FALLBACK_CONTEXT_WINDOW = 200_000
			const contextWindow =
				info?.contextWindow ?? persistedContextWindow ?? liveUsage?.size ?? FALLBACK_CONTEXT_WINDOW
			const persistedTokens =
				typeof existingMeta.tokens === "object" && existingMeta.tokens !== null
					? (existingMeta.tokens as { input?: number; output?: number })
					: undefined
			let inputTokens = persistedTokens?.input ?? liveUsage?.input ?? liveUsage?.used ?? 0
			let outputTokens = persistedTokens?.output ?? liveUsage?.output ?? 0
			// Estimation fallback: cursor sometimes doesn't report usage at
			// all (no usage_update notification, no PromptResponse.usage).
			// Without numbers, the UsageBar shows a 0% empty ring on
			// reload. Estimate from message content (~4 chars per token —
			// rough but matches what most tokenisers approximate). Counts
			// every text part across the conversation, attributing user
			// messages to input and assistant messages to output.
			if (inputTokens === 0 && outputTokens === 0) {
				const estimated = estimateTokensFromMessages(allMessages, args.systemPromptChars ?? 0)
				if (estimated.input > 0 || estimated.output > 0) {
					inputTokens = estimated.input
					outputTokens = estimated.output
				}
			}
			const persistedCost =
				typeof existingMeta.cost === "number" ? existingMeta.cost : (liveUsage?.cost ?? 0)
			queries.updateMessage(messageId, {
				metadata: {
					...existingMeta,
					modelId: modelRef.modelId,
					providerId: modelRef.providerId,
					agent: agentName,
					finish: args.overrideFinish ?? result?.finishReason ?? "stop",
					tokens: { input: inputTokens, output: outputTokens },
					cost: persistedCost,
					...(contextWindow ? { contextWindow } : {}),
				},
			})

			// Final usage broadcast at end-of-turn. If cursor never sent
			// `usage_update` during the turn, this is the only event the
			// UI gets for the turn — without it, the UsageBar would be
			// blank. If cursor DID send updates, this re-emit just snaps
			// the bar to the canonical end-of-turn value.
			if (contextWindow && (inputTokens > 0 || outputTokens > 0)) {
				bus().emit("session:usage", {
					sessionId,
					usage: { input: inputTokens, output: outputTokens },
					cost: persistedCost,
					contextWindow,
				})
			}
		} catch (err) {
			log.warn("updateMessage threw", {
				sessionId,
				error: err instanceof Error ? err.message : String(err),
			})
		}

		// Title generation: cursor's synthetic provider isn't registered
		// with ProviderRegistry, so the model-based path in
		// `ensureSessionTitle` can't run. Pass a customGenerator that
		// spawns a one-shot ACP session against the same binary — mirrors
		// `claude-code/runtime.ts:505` (which uses `claude -p` for the
		// same reason) and t3code's `CursorTextGeneration.generateThreadTitle`.
		void ensureSessionTitle({
			sessionId,
			customGenerator: async (firstUser) => {
				const userText = extractFirstUserText(firstUser)
				if (!userText) return undefined
				return generateCursorTitle({
					command: args.titleSpawn.command,
					cwd: args.titleSpawn.cwd,
					env: args.titleSpawn.env,
					userMessage: userText,
				})
			},
		}).catch((err) =>
			log.warn("ensureSessionTitle errored", {
				sessionId,
				error: err instanceof Error ? err.message : String(err),
			}),
		)
	} finally {
		setSessionStatus(sessionId, "idle")
	}
}

// ─── Resolution helpers ──────────────────────────────────────────────

function resolveAgentName(sessionId: string, body: PromptBody | undefined): string {
	const messages = queries.findMessagesBySessionId(sessionId)
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.role !== "user") continue
		const meta = msg.metadata as { agent?: string } | undefined
		if (meta?.agent) return meta.agent
		break
	}
	return body?.agent ?? "build"
}

function resolveCursorModel(
	sessionId: string,
	body: PromptBody | undefined,
): { modelId: string; providerId: string } | undefined {
	if (body?.model && body.model.providerId === CURSOR_PROVIDER_ID) return body.model
	const messages = queries.findMessagesBySessionId(sessionId)
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.role !== "user") continue
		const meta = msg.metadata as { model?: { modelId: string; providerId: string } } | undefined
		if (meta?.model && meta.model.providerId === CURSOR_PROVIDER_ID) return meta.model
		break
	}
	const agentName = body?.agent ?? "build"
	const agent = AgentRegistry.get(agentName)
	if (agent?.model && agent.model.providerId === CURSOR_PROVIDER_ID) return agent.model
	return body?.model
}

function resolveCwd(
	sessionId: string,
	sessionDirectory: string,
	state: ReturnType<typeof readCursorResumeState>,
): string {
	if (state.cursorCwd && existsSync(state.cursorCwd)) return state.cursorCwd
	if (state.cursorAgentId) {
		log.info("Stale Cursor cwd; clearing resume cursor", { sessionId, cwd: state.cursorCwd })
		clearCursorResume(sessionId)
	}
	return sessionDirectory
}

interface ErrorCategory {
	kind: "auth" | "rate-limit" | "transport" | "binary-not-found" | "unknown"
	source: "auth" | "rate-limit" | "stream" | "provider" | "runtime" | "cli"
	recoverable: boolean
	userMessage?: string
}

function categorizeCursorError(err: Error): ErrorCategory {
	const msg = err.message.toLowerCase()

	if (err instanceof AcpProtocolError) {
		if (
			err.code === -32000 ||
			msg.includes("auth") ||
			msg.includes("401") ||
			msg.includes("unauthorized") ||
			msg.includes("login")
		) {
			return {
				kind: "auth",
				source: "auth",
				recoverable: false,
				userMessage:
					"Cursor agent rejected authentication. Run `cursor login` (or set CURSOR_API_KEY) and retry.",
			}
		}
		if (msg.includes("rate") || msg.includes("429")) {
			return {
				kind: "rate-limit",
				source: "rate-limit",
				recoverable: true,
				userMessage: "Cursor rate limit hit. Wait a moment and retry.",
			}
		}
		return { kind: "unknown", source: "stream", recoverable: true }
	}

	if (err instanceof AcpTransportError) {
		if (msg.includes("enoent") || msg.includes("not found") || msg.includes("spawn")) {
			return {
				kind: "binary-not-found",
				source: "cli",
				recoverable: false,
				userMessage:
					"Cursor agent binary not found. Install Cursor.app or set the binary path in Settings.",
			}
		}
		return {
			kind: "transport",
			source: "stream",
			recoverable: true,
			userMessage: "Lost connection to Cursor agent. Retry the prompt.",
		}
	}

	return { kind: "unknown", source: "stream", recoverable: true }
}

function makePartEmitter(sessionId: string, messageId: string): CursorPartEmitter {
	return {
		upsertPart({ id, type, data }) {
			Database.withEffects((_tx, effect) => {
				queries.upsertPart({ id, sessionId, messageId, type, data })
				effect(() => {
					bus().emit("part:upsert", {
						sessionId,
						messageId,
						part: { id, ...(data as Record<string, unknown>) },
					})
				})
			})
		},
		emitDelta({ partId, delta, partType }) {
			bus().emit("part:delta", { sessionId, messageId, partId, delta, partType })
		},
	}
}

// ─── Plan approval bridge ────────────────────────────────────────────

const PLAN_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000

type PlanApprovalOutcome =
	| { kind: "approve" }
	| { kind: "feedback"; feedback: string }
	| { kind: "cancelled" }

/**
 * End-of-turn plan-approval prompt. Cursor's plan agent doesn't have access
 * to Loop's `plan_exit` tool (Cursor owns its tool registry), so we
 * synthesize the same askUser flow that `plan_exit` uses: emit a
 * `question:request` event, render PlanCard + PlanApproval on the
 * frontend, await the user's reply.
 */
async function askPlanApproval(args: {
	sessionId: string
	planPath: string
	planContent: string
	signal: AbortSignal
}): Promise<PlanApprovalOutcome> {
	const { sessionId, planPath, planContent, signal } = args
	const questionId = ulid()
	const deferred = new Deferred<string[]>()
	pendingQuestions().set(questionId, deferred)

	const summaryPreview = planContent.length > 500 ? `${planContent.slice(0, 500)}...` : planContent
	const text = `Approve plan and switch to build mode?\nPlan file: ${planPath}\n\n${summaryPreview}\n\nThe build agent will implement changes based on this plan.`

	bus().emit("question:request", {
		sessionId,
		question: { id: questionId, sessionId, tool: "plan_exit", text },
	})
	setSessionStatus(sessionId, "awaiting-permission")

	let abortHandler: (() => void) | undefined
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		const answer = await Promise.race([
			deferred.promise.then((answers) => answers[0] ?? ""),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("plan approval timed out")),
					PLAN_APPROVAL_TIMEOUT_MS,
				)
			}),
			new Promise<never>((_resolve, reject) => {
				if (signal.aborted) {
					reject(new Error("aborted"))
					return
				}
				abortHandler = () => reject(new Error("aborted"))
				signal.addEventListener("abort", abortHandler, { once: true })
			}),
		])
		const trimmed = answer.toLowerCase().trim()
		if (trimmed === "yes" || trimmed === "y" || trimmed === "ok") {
			return { kind: "approve" }
		}
		return { kind: "feedback", feedback: answer.trim() || "Plan rejected." }
	} catch (err) {
		log.info("Plan approval cancelled", {
			sessionId,
			error: err instanceof Error ? err.message : String(err),
		})
		return { kind: "cancelled" }
	} finally {
		clearTimeout(timer)
		if (abortHandler) signal.removeEventListener("abort", abortHandler)
		pendingQuestions().delete(questionId)
		setSessionStatus(sessionId, "idle")
	}
}

/**
 * Stable partId for the synthesized plan-exit Part. We need a stable
 * id so the "running" emission and the "completed" finalize land on
 * the SAME row in the UI — the second upsert mutates the first.
 *
 * Keyed by sessionId + messageId so concurrent sessions don't collide.
 */
function planExitPartId(sessionId: string, messageId: string): string {
	return `plan-exit-${sessionId}-${messageId}`
}

/**
 * Synthesize a `plan-exit` tool Part on the assistant message so the
 * UI's PlanExitToolCall picks it up and renders PlanCard + PlanApproval.
 *
 * Mirrors the Claude Code path where the actual `plan_exit` tool's
 * execution naturally emits this Part. For cursor we have to synthesize
 * because cursor uses its own tool registry (it has Edit, Write, but no
 * plan_exit) — the plan content comes from the file write detection in
 * the adapter, and we re-shape it as a plan-exit Part here.
 */
function synthesizePlanExitPart(args: {
	sessionId: string
	messageId: string
	planPath: string
	planContent: string
}): void {
	const { sessionId, messageId, planPath, planContent } = args
	const partId = planExitPartId(sessionId, messageId)
	const data: Record<string, unknown> = {
		type: "tool",
		callId: partId,
		tool: "plan-exit",
		state: "running",
		time: { start: Date.now() },
		metadata: {
			planPath,
			planContent,
			source: "cursor-runtime-synthetic",
		},
	}
	Database.withEffects((_tx, effect) => {
		queries.upsertPart({ id: partId, sessionId, messageId, type: "tool", data })
		effect(() => {
			bus().emit("part:upsert", {
				sessionId,
				messageId,
				part: { id: partId, ...data },
			})
		})
	})
}

/**
 * Mark the synthesized plan-exit Part as completed once the user has
 * answered. PlanApproval gates its visibility on `isActive(part)` —
 * keeping the buttons hidden after the user has decided.
 */
function finalizePlanExitPart(args: {
	sessionId: string
	messageId: string
	planPath: string
	planContent: string
}): void {
	const { sessionId, messageId, planPath, planContent } = args
	const partId = planExitPartId(sessionId, messageId)
	const data: Record<string, unknown> = {
		type: "tool",
		callId: partId,
		tool: "plan-exit",
		state: "completed",
		time: { start: Date.now(), end: Date.now() },
		metadata: {
			planPath,
			planContent,
			source: "cursor-runtime-synthetic",
		},
	}
	Database.withEffects((_tx, effect) => {
		queries.upsertPart({ id: partId, sessionId, messageId, type: "tool", data })
		effect(() => {
			bus().emit("part:upsert", {
				sessionId,
				messageId,
				part: { id: partId, ...data },
			})
		})
	})
}

/**
 * Create a synthetic user message that the runtime's existing handoff
 * check will pick up to switch agents. Mirrors `createSyntheticMessage`
 * in `tool/builtin/plan.ts` so the wire shape stays consistent across
 * the AI-SDK and Cursor paths.
 */
function createPlanSyntheticUserMessage(args: {
	sessionId: string
	agent: string
	text: string
}): void {
	const { sessionId, agent, text } = args
	const messageId = ulid()
	const partId = ulid()
	Database.withEffects((_tx, effect) => {
		queries.createMessage({
			id: messageId,
			sessionId,
			role: "user",
			metadata: { agent, synthetic: true },
		})
		queries.upsertPart({
			id: partId,
			sessionId,
			messageId,
			type: "text",
			data: { type: "text", text, synthetic: true },
		})
		effect(() => {
			bus().emit("message:create", {
				sessionId,
				message: {
					id: messageId,
					sessionId,
					role: "user",
					metadata: { agent, synthetic: true },
					createdAt: Date.now(),
					updatedAt: Date.now(),
					parts: [{ id: partId, type: "text", text, synthetic: true }],
				},
			})
		})
	})
}

/**
 * Extract markdown plan content from a `cursor/create_plan` extension
 * payload. The shape is `{plan: string, todos?, phases?, ...}` per
 * Cursor's spec; we accept a few field aliases defensively.
 */
function extractCursorPlanMarkdown(params: unknown): string | undefined {
	if (!params || typeof params !== "object") return undefined
	const r = params as Record<string, unknown>
	for (const key of ["plan", "planMarkdown", "markdown", "content", "text"]) {
		const v = r[key]
		if (typeof v === "string" && v.trim().length > 0) return v
	}
	return undefined
}

/**
 * Extract todo items + the `merge` flag from cursor's
 * `cursor/update_todos` extension request.
 *
 * Cursor sends this as either:
 *   - flat: { merge?: bool, todos: [...] }
 *   - nested under `request`: { request: { merge?: bool, todos: [...] } }
 *
 * Items have `id`, `content` (or `title`), `status`, optional `priority`
 * and `activeForm`. Probe both shapes so the handler works across
 * cursor versions. Returns undefined when no items are present.
 */
function extractCursorUpdateTodos(params: unknown):
	| {
			todos: ReadonlyArray<{
				id?: string
				content?: string
				title?: string
				status?: string
				priority?: string
				activeForm?: string
			}>
			merge?: boolean
	  }
	| undefined {
	if (!params || typeof params !== "object") return undefined
	const tryRead = (
		obj: Record<string, unknown>,
	):
		| {
				todos: ReadonlyArray<{
					id?: string
					content?: string
					title?: string
					status?: string
					priority?: string
					activeForm?: string
				}>
				merge?: boolean
		  }
		| undefined => {
		// Look for the items array under several common keys cursor /
		// ACP extensions use across versions.
		let list: unknown
		for (const key of ["todos", "items", "tasks", "todoItems", "todo_items"]) {
			if (Array.isArray(obj[key])) {
				list = obj[key]
				break
			}
		}
		if (!Array.isArray(list)) return undefined
		const todos = list
			.filter((t): t is Record<string, unknown> => t !== null && typeof t === "object")
			.map((t) => ({
				id: typeof t.id === "string" ? t.id : undefined,
				content: typeof t.content === "string" ? t.content : undefined,
				title: typeof t.title === "string" ? t.title : undefined,
				status: typeof t.status === "string" ? t.status : undefined,
				priority: typeof t.priority === "string" ? t.priority : undefined,
				activeForm: typeof t.activeForm === "string" ? t.activeForm : undefined,
			}))
		if (todos.length === 0) return undefined
		const merge = typeof obj.merge === "boolean" ? obj.merge : undefined
		return merge !== undefined ? { todos, merge } : { todos }
	}

	const flat = tryRead(params as Record<string, unknown>)
	if (flat) return flat
	// Some cursor versions wrap the payload under `request` per ACP
	// extension-request convention.
	const nested = (params as { request?: unknown }).request
	if (nested && typeof nested === "object") {
		return tryRead(nested as Record<string, unknown>)
	}
	return undefined
}

/** Exposed for testing — see `pickAutoApprovalOptionId`. */
export function _pickAutoApprovalOptionIdForTesting(
	options: ReadonlyArray<{ optionId: string; kind: string }>,
): string | undefined {
	return pickAutoApprovalOptionId(options)
}

/**
 * Pick the strongest "allow" option id Cursor offered for a permission
 * request. Returns undefined when neither allow_always nor allow_once is
 * present (so the caller can fall through to the user prompt path).
 *
 * Mirrors t3code's `selectAutoApprovedPermissionOption`.
 */
function pickAutoApprovalOptionId(
	options: ReadonlyArray<{ optionId: string; kind: string }>,
): string | undefined {
	const always = options.find((o) => o.kind === "allow_always")
	if (always?.optionId?.trim()) return always.optionId.trim()
	const once = options.find((o) => o.kind === "allow_once")
	if (once?.optionId?.trim()) return once.optionId.trim()
	return undefined
}

/**
 * Cursor's `cursor/ask_question` ACP extension. Cursor uses this to ask
 * the user a clarifying question mid-turn (e.g. "Which file did you
 * mean?"). We bridge it onto Loop's standard `question:request` flow so
 * the user sees the same UI as Loop's question tool, then return the
 * selected answer back to Cursor.
 *
 * Spec (per CursorAskQuestionRequest): `{ toolCallId, title?, questions:
 * [{id, prompt, options: [{id, label}], allowMultiple?}] }`. Reply
 * shape: `{ answers: { [questionId]: optionId | optionId[] } }`.
 */
async function handleCursorAskQuestion(args: {
	sessionId: string
	params: unknown
	signal: AbortSignal
}): Promise<unknown> {
	const { sessionId, params, signal } = args
	if (!params || typeof params !== "object") return { answers: {} }
	const r = params as Record<string, unknown>
	const questions = Array.isArray(r.questions)
		? (r.questions as Array<Record<string, unknown>>)
		: []
	if (questions.length === 0) return { answers: {} }

	const questionId = ulid()
	const deferred = new Deferred<string[]>()
	pendingQuestions().set(questionId, deferred)

	const uiQuestions = questions.map((q) => {
		const opts = Array.isArray(q.options) ? (q.options as Array<Record<string, unknown>>) : []
		return {
			question: typeof q.prompt === "string" ? q.prompt : String(q.prompt ?? ""),
			options: opts.map((opt) => ({
				label: typeof opt.label === "string" ? opt.label : String(opt.id ?? ""),
				description:
					typeof opt.description === "string"
						? opt.description
						: typeof opt.label === "string"
							? opt.label
							: undefined,
			})),
			multiple: q.allowMultiple === true,
		}
	})

	const titleText = typeof r.title === "string" ? r.title : "Cursor needs your input"
	bus().emit("question:request", {
		sessionId,
		question: { id: questionId, sessionId, tool: "cursor_ask_question", questions: uiQuestions },
	})
	setSessionStatus(sessionId, "awaiting-permission")

	let abortHandler: (() => void) | undefined
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		const answers = await Promise.race([
			deferred.promise,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(() => reject(new Error("ask_question timed out")), 5 * 60 * 1000)
			}),
			new Promise<never>((_resolve, reject) => {
				if (signal.aborted) {
					reject(new Error("aborted"))
					return
				}
				abortHandler = () => reject(new Error("aborted"))
				signal.addEventListener("abort", abortHandler, { once: true })
			}),
		])
		// Map answers back to Cursor's `{ [questionId]: optionId | optionId[] }`
		// shape. We answered each question with one option label; resolve to
		// the matching option id.
		const answerMap: Record<string, string | string[]> = {}
		for (let i = 0; i < questions.length && i < answers.length; i++) {
			const q = questions[i]
			const reply = answers[i]
			const opts = Array.isArray(q.options) ? (q.options as Array<Record<string, unknown>>) : []
			const matching = opts.find(
				(o) => o.label === reply || o.id === reply || (typeof o.id === "string" && o.id === reply),
			)
			const qId = typeof q.id === "string" ? q.id : `q-${i}`
			if (matching && typeof matching.id === "string") {
				answerMap[qId] = matching.id
			} else if (typeof reply === "string" && reply.length > 0) {
				answerMap[qId] = reply
			}
		}
		return { answers: answerMap }
	} catch (err) {
		log.info("cursor/ask_question cancelled", {
			sessionId,
			error: err instanceof Error ? err.message : String(err),
		})
		return { answers: {} }
	} finally {
		clearTimeout(timer)
		if (abortHandler) signal.removeEventListener("abort", abortHandler)
		pendingQuestions().delete(questionId)
		setSessionStatus(sessionId, "busy")
		void titleText
	}
}

// Unused but kept for ABI consistency with other runtimes; lint-quiets.
export type { Part as _CursorPartType }
