import { pathToFileURL } from "node:url"
import { ulid } from "@core/id"
import { AgentRegistry } from "../../agent"
import { buildOpenCodePlanReminder, getModeReminder } from "../../agent/prompt/inject"
import { assembleSystemPrompt } from "../../agent/prompt/system"
import * as Config from "../../config"
import * as Database from "../../db"
import * as queries from "../../db/queries"
import { createLogger } from "../../logger"
import { disabledTools, resolveRuleset } from "../../permission"
import { planPath, readPlan, writePlan } from "../../plan"
import { detectOpenCode } from "../../provider/opencode"
import { parseOpenCodeModelId } from "../../provider/opencode/constants"
import { ToolRegistry } from "../../tool"
import { bus } from "../../workspace/bus"
import type { PromptBody } from "../index"
import { markSessionErrorEmitted } from "../prompt"
import { snapshot } from "../snapshot"
import { setSessionStatus } from "../status"
import { ensureSessionTitle } from "../title"
import {
	type OpenCodeAdapterOptions,
	type OpenCodePartEmitter,
	createOpenCodeAdapter,
} from "./adapter"
import { registerOpenCodePermission, resolveOpenCodePermission } from "./permission-bridge"
import { clearResumeState, persistOpenCodeResume, readOpenCodeResumeState } from "./session"
import { closeSessionRuntime, ensureSessionRuntime } from "./session-runtime"
import { generateOpenCodeTitle } from "./title"
import { loopToolToOpenCodeNames } from "./tool-mapping"

/**
 * OpenCode runtime for Loop sessions.
 *
 * Streaming model:
 *   - Per Loop session we hold one OpenCode connection + one event-subscribe
 *     stream (see `session-runtime.ts`). Reused across turns.
 *   - Each turn creates a fresh adapter (turn-scoped state, bound to the
 *     assistant message ID), attaches it to the session runtime, then sends
 *     the prompt with `client.session.promptAsync()`. Streaming events
 *     arrive via the SSE subscription and flow into the adapter, which
 *     translates them to Loop parts (text deltas, tool state machine,
 *     reasoning, step-finish with usage).
 *   - Permission requests from OpenCode are forwarded to Loop's permission
 *     UI via the `permission-bridge` so the existing settings/UI pipeline
 *     handles approval — replies are forwarded back to OpenCode.
 *
 * This mirrors t3code's adapter+runtime split, adapted to Loop's
 * `Database.withEffects` + `bus()` plumbing instead of Effect.
 */

const log = createLogger("opencode-runtime")

/** Hard ceiling on a single turn. Real coding work routinely runs past 5
 *  minutes, so we set a generous absolute cap. The stale-event watchdog
 *  below catches "hung but quietly" cases much sooner. */
const TURN_IDLE_TIMEOUT_MS = 30 * 60 * 1000

/** If no events arrive from OpenCode for this long after at least one event
 *  has been seen, declare the turn done. Catches OpenCode builds that go
 *  silent without firing `session.idle` / `session.status: idle`. */
const STALE_EVENT_TIMEOUT_MS = 90 * 1000

/**
 * Entry point invoked by `runSession` (`dispatch.ts`) when the resolved
 * provider is `opencode`.
 */
export async function runOpenCodeLoop(
	sessionId: string,
	signal: AbortSignal,
	body?: PromptBody,
): Promise<void> {
	// ─── 1. Resolve session + agent + model + prompt ─────────────
	const session = queries.findSessionById(sessionId)
	if (!session) throw new Error(`Session not found: ${sessionId}`)

	// Mirror Loop's main loop agent stickiness: last user message metadata
	// pins the agent across turns. This is what makes plan→build switching
	// work — the synthetic user message from `plan_exit` carries the new
	// agent name. Same resolution chain `runLoop` uses (index.ts:160-170).
	const agentName = resolveAgentName(sessionId, body)
	const agent = AgentRegistry.get(agentName)
	if (!agent) throw new Error(`Agent not found: ${agentName}`)

	const modelRef = resolveOpenCodeModel(sessionId, body)
	if (!modelRef) {
		throw new Error(
			"OpenCode turn missing a model reference. Pick an OpenCode model before sending.",
		)
	}

	const parsed = parseOpenCodeModelId(modelRef.modelId)
	if (!parsed) {
		const msg = `Invalid OpenCode model id "${modelRef.modelId}". Expected "<provider>/<model>" format.`
		emitError(sessionId, "provider", msg)
		const err = new Error(msg)
		markSessionErrorEmitted(err)
		throw err
	}

	const promptText = extractLastUserPromptText(sessionId)
	if (!promptText) {
		throw new Error("No user prompt text found for OpenCode turn")
	}

	// ─── 2. Detect / probe OpenCode ──────────────────────────────
	const detection = await detectOpenCode()
	if (!detection.installed) {
		const msg =
			"OpenCode CLI is not installed. Install it from https://opencode.ai or configure a remote server in Settings → Providers."
		emitError(sessionId, "cli", msg)
		const err = new Error(msg)
		markSessionErrorEmitted(err)
		throw err
	}
	if (!detection.connected) {
		const msg =
			detection.error ??
			"OpenCode is installed but not reachable. Check Settings → Providers → OpenCode and rescan."
		emitError(sessionId, "auth", msg)
		const err = new Error(msg)
		markSessionErrorEmitted(err)
		throw err
	}

	// ─── 3. Create the assistant message placeholder ─────────────
	const assistantMessageId = ulid()
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

	// ─── 4. Capture the pre-turn snapshot ─────────────────────────
	let preSnapshotHash: string | undefined
	try {
		const mgr = await snapshot()
		preSnapshotHash = await mgr.capture()
	} catch (err) {
		log.warn("Pre-turn snapshot failed", {
			sessionId,
			error: err instanceof Error ? err.message : String(err),
		})
	}

	// Emit a Loop-flavored step-start part so `/sessions/:id/diff` can find
	// the FROM hash (it walks parts looking for the earliest step-start
	// snapshot). OpenCode's step-start parts carry OpenCode's own snapshot
	// hashes which Loop's shadow-git doesn't recognise — without this our
	// edit-diff aggregator says "Diff unavailable for this edit".
	if (preSnapshotHash) {
		const stepStartId = ulid()
		const stepStartData = { type: "step-start", snapshot: preSnapshotHash }
		Database.withEffects((_tx, effect) => {
			queries.upsertPart({
				id: stepStartId,
				sessionId,
				messageId: assistantMessageId,
				type: "step-start",
				data: stepStartData,
			})
			effect(() => {
				bus().emit("part:upsert", {
					sessionId,
					messageId: assistantMessageId,
					part: { id: stepStartId, ...stepStartData },
				})
			})
		})
	}

	// ─── 5. Settings + working directory ─────────────────────────
	// Session creation now happens inside ensureSessionRuntime (below) so the
	// session lives on the SAME connection that subscribes to events and
	// sends prompts. Doing it on a one-shot connection in local mode would
	// silently lose history — the throwaway server's session id is unknown
	// to the long-lived runtime's server, which would either error or
	// silently create a fresh session per prompt.
	const settings = Config.read().opencode
	const isRemote = settings.serverUrl.trim().length > 0
	const directory = session.directory ?? process.cwd()

	const resume = readOpenCodeResumeState(sessionId)

	// ─── 6. Build emitter + adapter + attach to runtime ──────────
	const emitter = createEmitter(sessionId, assistantMessageId)
	const contextWindow =
		(detection.models?.find((m) => m.id === modelRef.modelId)?.contextWindow ?? 0) || 0

	const adapterOpts: OpenCodeAdapterOptions = {
		emitter,
		onSessionId: () => {
			// Already persisted above when we created the session — keeping
			// the callback for parity with the cursor / claude-code shape.
		},
		onUsageUpdate: (usage) => {
			bus().emit("session:usage", {
				sessionId,
				usage,
				cost: 0,
				contextWindow,
			})
		},
		onPermissionAsked: (req) => {
			// Bridge to Loop's permission UI. Pending approval blocks the
			// OpenCode side — when the user replies in Loop, the bridge
			// forwards the reply to OpenCode via `client.permission.reply`.
			registerOpenCodePermission({
				sessionId,
				request: req,
				reply: async (decision) => {
					try {
						await runtime.connection.client.permission.reply({
							requestID: req.id,
							directory,
							reply: decision,
						})
					} catch (err) {
						log.warn("Failed to reply to OpenCode permission", {
							sessionId,
							requestId: req.id,
							error: err instanceof Error ? err.message : String(err),
						})
					}
				},
			})
		},
		onSessionError: (message) => {
			emitError(sessionId, "stream", message)
			// A session error means the turn is over — release awaitIdle.
			runtime.signalIdle()
		},
		onIdle: () => {
			runtime.signalIdle()
		},
	}
	const adapter = createOpenCodeAdapter(adapterOpts)
	adapter.beginTurn(preSnapshotHash)

	const runtime = await ensureSessionRuntime({
		sessionId,
		directory,
		binaryPath: detection.binaryPath ?? settings.binaryPath,
		...(isRemote ? { serverUrl: settings.serverUrl } : {}),
		...(isRemote && settings.serverPassword ? { serverPassword: settings.serverPassword } : {}),
		...(resume.openCodeSessionId ? { resumeOpenCodeSessionId: resume.openCodeSessionId } : {}),
		sessionTitle: session.title ?? "Loop session",
	})
	// Persist the resolved id (might be a fresh one if resume failed). All
	// future turns will resume against this same OpenCode session, preserving
	// conversation history end-to-end. We also persist `cwd` so a process
	// restart can detect a stale directory and fall back to a fresh session
	// instead of erroring mid-turn — same shape Cursor uses.
	const openCodeSessionId = runtime.openCodeSessionId
	if (openCodeSessionId !== resume.openCodeSessionId || directory !== resume.openCodeCwd) {
		persistOpenCodeResume(sessionId, {
			openCodeSessionId,
			openCodeCwd: directory,
		})
	}
	runtime.attachAdapter(adapter)

	// ─── 7. Wire abort ──────────────────────────────────────────
	let abortHandler: (() => void) | undefined
	if (signal.aborted) {
		await runtime.abortTurn()
	} else {
		abortHandler = () => {
			log.info("Aborting OpenCode turn", { sessionId })
			void runtime.abortTurn()
		}
		signal.addEventListener("abort", abortHandler, { once: true })
	}

	// ─── 7b. Assemble Loop's system prompt + tool filter ─────────
	// OpenCode owns its own system prompt + tools, but `session.prompt`
	// accepts a `system` override and a `tools` deny map. Passing Loop's
	// `assembleSystemPrompt` output keeps CLAUDE.md/AGENTS.md, env block,
	// MCP/skill listings, and the agent's own instructions in lockstep
	// with the main loop. The `tools` map enforces Loop's permission
	// ruleset on top of OpenCode's built-ins.
	let systemPrompt: string | undefined
	try {
		systemPrompt = await assembleSystemPrompt({ agent, modelId: modelRef.modelId })
	} catch (err) {
		log.warn("assembleSystemPrompt failed; OpenCode will use its built-in", {
			sessionId,
			error: err instanceof Error ? err.message : String(err),
		})
	}

	const sessionRuleset = Array.isArray(session.permission)
		? (session.permission as import("@core/schema/permission").PermissionRuleset)
		: []
	const ruleset = resolveRuleset(
		agent.permission ?? [],
		(session.permissionMode as string | undefined) ?? "default",
		sessionRuleset,
	)
	const denied = disabledTools(
		ToolRegistry.all().map((t) => t.id),
		ruleset,
	)
	// CRITICAL: translate Loop tool IDs (e.g. `apply_patch`, `bash_output`) to
	// OpenCode's native tool names (`patch`/`apply-patch`, `bash-output`)
	// before building the deny filter. Without this translation, OpenCode
	// silently ignores filters keyed on names it doesn't recognise — and the
	// plan agent ends up with full edit/write/multiedit access despite the
	// ruleset.
	const toolFilter = buildToolFilter(denied)
	// Loop's `plan_write` / `plan_exit` are tools the SDK doesn't expose —
	// explicitly block them so a model that ignores the reminder and tries
	// to invoke them fails the filter instead of producing a confusing
	// "tool not found" error mid-turn. (The plan agent's permission rules
	// already ALLOW plan_write/plan_exit on the Loop side, so they don't
	// appear in `denied`. But OpenCode shouldn't see them either way —
	// the host synthesises the plan-exit part itself.)
	if (agentName === "plan") {
		toolFilter.plan_write = false
		toolFilter["plan-write"] = false
		toolFilter.plan_exit = false
		toolFilter["plan-exit"] = false
		toolFilter.exit_plan_mode = false
		toolFilter.exitplanmode = false
	}

	// Reasoning effort propagation (chain matches main loop):
	// body override → last user message metadata → global config default.
	const reasoningEffort =
		body?.reasoningEffort ??
		extractReasoningEffortFromMessages(sessionId) ??
		Config.read().reasoning?.effort
	const variant = mapEffortToVariant(reasoningEffort)

	// ─── 7c. Build prompt parts: text + reminder + file attachments ─────
	// OpenCode owns history; we send ONLY the new user turn here. Mirror the
	// main loop's `insertReminders()` behaviour by appending the plan / build
	// switch reminder as a synthetic text part. Without this, OpenCode's plan
	// agent has no idea it's in read-only mode and happily uses Edit/Write.
	const reminderText = buildOpenCodeReminder(
		sessionId,
		agentName,
		queries.findMessagesBySessionId(sessionId),
	)
	const fileParts = buildOpenCodeFileParts(sessionId)
	const promptParts: Array<Record<string, unknown>> = [{ type: "text", text: promptText }]
	if (reminderText) promptParts.push({ type: "text", text: reminderText })
	for (const fp of fileParts) promptParts.push(fp)

	// ─── 8. Send the prompt + drive streaming ───────────────────
	let turnError: Error | undefined
	try {
		await runtime.connection.client.session.promptAsync({
			sessionID: openCodeSessionId,
			directory,
			model: { providerID: parsed.upstreamProviderId, modelID: parsed.upstreamModelId },
			agent: agentName,
			...(systemPrompt ? { system: systemPrompt } : {}),
			...(Object.keys(toolFilter).length > 0 ? { tools: toolFilter } : {}),
			...(variant ? { variant } : {}),
			parts: promptParts as Parameters<
				typeof runtime.connection.client.session.promptAsync
			>[0]["parts"],
		})

		// Wait for the turn to complete. Multi-signal idle detection:
		//  1. adapter fires `onIdle` on `session.status: idle` / `session.idle`
		//  2. adapter fires `onIdle` on `step.ended` with terminal finish + no
		//     in-flight tools (most reliable for long turns)
		//  3. session-runtime stale-event watchdog (no events for 90s = done)
		//  4. absolute timeout at 30 min as a final ceiling
		await runtime.awaitIdle(TURN_IDLE_TIMEOUT_MS, STALE_EVENT_TIMEOUT_MS)
	} catch (err) {
		if (signal.aborted) {
			log.info("OpenCode turn aborted", { sessionId })
		} else {
			turnError = err instanceof Error ? err : new Error(String(err))
			log.error("OpenCode runtime error", { sessionId, error: turnError.message })
			emitError(sessionId, "stream", turnError.message)
			markSessionErrorEmitted(turnError)
		}
	} finally {
		if (abortHandler) signal.removeEventListener("abort", abortHandler)
		runtime.detachAdapter()
		// Resolve any in-flight permission requests with reject so the SDK
		// doesn't sit waiting for a reply that will never come.
		resolveOpenCodePermission(sessionId, "reject")
	}

	// ─── 9. Finalize the adapter ────────────────────────────────
	const result = adapter.finalize()
	if (result.usage.input + result.usage.output > 0) {
		bus().emit("session:usage", {
			sessionId,
			usage: result.usage,
			cost: result.cost,
			contextWindow,
		})
	}

	// Capture Loop's own post-turn snapshot. This serves two purposes:
	//   1. Emit a step-finish part with the TO hash so the diff route
	//      (`/sessions/:id/diff`) can compute the unified per-file diff
	//      between our step-start and this step-finish.
	//   2. Layer C4 fallback EditPart when OpenCode's `session.diff` didn't
	//      fire (older CLI, no edits the server tracked, etc.).
	if (!turnError && !signal.aborted && preSnapshotHash) {
		try {
			const mgr = await snapshot()
			const postHash = await mgr.capture()
			if (postHash && postHash !== preSnapshotHash) {
				// Always emit the step-finish so the diff route can resolve.
				const stepFinishId = ulid()
				const stepFinishData = {
					type: "step-finish",
					finishReason: "stop",
					snapshot: postHash,
				}
				Database.withEffects((_tx, effect) => {
					queries.upsertPart({
						id: stepFinishId,
						sessionId,
						messageId: assistantMessageId,
						type: "step-finish",
						data: stepFinishData,
					})
					effect(() => {
						bus().emit("part:upsert", {
							sessionId,
							messageId: assistantMessageId,
							part: { id: stepFinishId, ...stepFinishData },
						})
					})
				})

				// Layer C4 EditPart fallback — only when `session.diff` didn't
				// already produce one (deduplication).
				if (!adapter.didEmitEditFromDiff()) {
					const fileDiffs = await mgr.diffStats(preSnapshotHash, postHash)
					if (fileDiffs.length > 0) {
						const editPartId = ulid()
						const editData = {
							type: "edit" as const,
							hash: preSnapshotHash,
							files: fileDiffs.map((f) => ({
								path: f.path,
								additions: f.additions,
								deletions: f.deletions,
								status: (f.status ?? "modified") as "added" | "deleted" | "modified",
							})),
							totalAdditions: fileDiffs.reduce((s, f) => s + f.additions, 0),
							totalDeletions: fileDiffs.reduce((s, f) => s + f.deletions, 0),
						}
						Database.withEffects((_tx, effect) => {
							queries.upsertPart({
								id: editPartId,
								sessionId,
								messageId: assistantMessageId,
								type: "edit",
								data: editData,
							})
							effect(() => {
								bus().emit("part:upsert", {
									sessionId,
									messageId: assistantMessageId,
									part: { id: editPartId, ...editData },
								})
							})
						})
					}
				}
			}
		} catch (err) {
			log.warn("Post-turn snapshot fallback failed", {
				sessionId,
				error: err instanceof Error ? err.message : String(err),
			})
		}
	}

	// ─── 9b. Plan-mode end-of-turn: synthesize plan-exit tool part ─────
	//
	// OpenCode's plan agent doesn't emit a dedicated "plan exit" tool — its
	// output is just the assistant's text. Mirror Claude Code's
	// ExitPlanMode flow: collect the assistant text, write it to
	// `.loop/plans/<sessionId>.md`, and synthesize a tool part with
	// `tool: "plan-exit"` and `metadata.planContent` so the existing
	// PlanCard renderer (`tool-call.tsx:1087`) shows the approval card.
	//
	// Without this, the user sees raw markdown text and has no
	// approve/reject action — the plan→build switch can't happen.
	if (!turnError && !signal.aborted && agentName === "plan") {
		try {
			const assistantText = collectAssistantText(assistantMessageId)
			if (assistantText.trim().length > 0) {
				const writtenPath = writePlan(sessionId, assistantText)
				const planExitPartId = ulid()
				const planExitData = {
					type: "tool",
					callId: planExitPartId,
					tool: "plan-exit",
					state: "completed",
					input: { plan: assistantText },
					output: writtenPath,
					metadata: {
						planContent: assistantText,
						planPath: writtenPath,
					},
					time: { start: Date.now(), end: Date.now() },
				}
				Database.withEffects((_tx, effect) => {
					queries.upsertPart({
						id: planExitPartId,
						sessionId,
						messageId: assistantMessageId,
						type: "tool",
						data: planExitData,
					})
					effect(() => {
						bus().emit("part:upsert", {
							sessionId,
							messageId: assistantMessageId,
							part: { id: planExitPartId, ...planExitData },
						})
					})
				})
			}
		} catch (err) {
			log.warn("Plan-mode end-of-turn synthesis failed", {
				sessionId,
				error: err instanceof Error ? err.message : String(err),
			})
		}
	}

	// If nothing streamed at all (and we didn't error), surface a placeholder
	// so the assistant message isn't visually empty.
	if (!turnError && !signal.aborted) {
		const hasAnyPart = queries.findPartsByMessageId(assistantMessageId).length
		if (hasAnyPart === 0) {
			persistTextPart(sessionId, assistantMessageId, "(OpenCode returned no output.)")
		}
	}

	// Title generation: OpenCode is a synthetic provider so the standard
	// model-based path in `ensureSessionTitle` can't resolve it. Pass a
	// `customGenerator` that runs a one-shot OpenCode prompt — same
	// pattern Claude Code uses (`generateClaudeCodeTitle`). Falls back to
	// deterministic derivation when the OpenCode call fails.
	void ensureSessionTitle({
		sessionId,
		customGenerator: async (firstUser) => {
			const userText = extractFirstUserText(firstUser)
			if (!userText) return undefined
			return generateOpenCodeTitle({
				cwd: directory,
				upstreamProviderId: parsed.upstreamProviderId,
				upstreamModelId: parsed.upstreamModelId,
				userMessage: userText,
			})
		},
	}).catch((err) =>
		log.warn("ensureSessionTitle errored", {
			sessionId,
			error: err instanceof Error ? err.message : String(err),
		}),
	)

	if (signal.aborted) {
		// Soft-stop; tear the runtime down so the next turn rebuilds cleanly.
		await closeSessionRuntime(sessionId)
	}

	setSessionStatus(sessionId, "idle")

	if (turnError) throw turnError
}

/** Pull the plain-text content from a user message — used as the title seed. */
function extractFirstUserText(msg: {
	parts?: Array<{ type?: string; text?: string }>
}): string | undefined {
	const text = (msg.parts ?? [])
		.filter((p) => p.type === "text" && typeof p.text === "string")
		.map((p) => p.text ?? "")
		.join("\n")
		.trim()
	return text || undefined
}

// ─── Helpers ───────────────────────────────────────────────────────────

/** PartEmitter implementation bound to a Loop session+message. */
function createEmitter(sessionId: string, messageId: string): OpenCodePartEmitter {
	return {
		upsertPart(part) {
			Database.withEffects((_tx, effect) => {
				queries.upsertPart({
					id: part.id,
					sessionId,
					messageId,
					type: part.type,
					data: part.data,
				})
				effect(() => {
					bus().emit("part:upsert", {
						sessionId,
						messageId,
						part: { id: part.id, ...part.data },
					})
				})
			})
		},
		emitDelta({ partId, delta, partType }) {
			bus().emit("part:delta", {
				sessionId,
				messageId,
				partId,
				delta,
				partType,
			})
		},
	}
}

function extractLastUserPromptText(sessionId: string): string | undefined {
	const messages = queries.findMessagesBySessionId(sessionId)
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.role !== "user") continue
		const parts = (msg as { parts?: Array<{ type: string; text?: string }> }).parts ?? []
		const text = parts
			.filter((p) => p.type === "text")
			.map((p) => p.text ?? "")
			.join("\n")
			.trim()
		if (text) return text
		break
	}
	return undefined
}

function resolveOpenCodeModel(
	sessionId: string,
	body: PromptBody | undefined,
): { modelId: string; providerId: string } | undefined {
	if (body?.model) return body.model
	const messages = queries.findMessagesBySessionId(sessionId)
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.role !== "user") continue
		const meta = msg.metadata as { model?: { modelId: string; providerId: string } } | undefined
		if (meta?.model) return meta.model
		break
	}
	return undefined
}

/**
 * Resolve the active agent name for a turn — same precedence as the main
 * loop's `resolveAgentName`. Without this, plan→build switching via
 * synthetic user messages (set by `plan_exit`) would be silently lost on
 * the OpenCode path.
 */
function resolveAgentName(sessionId: string, body: PromptBody | undefined): string {
	const messages = queries.findMessagesBySessionId(sessionId)
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.role === "user") {
			const meta = msg.metadata as { agent?: string } | undefined
			if (meta?.agent) return meta.agent
			break
		}
	}
	return body?.agent ?? "build"
}

/**
 * Build OpenCode's `tools: { [name]: boolean }` filter from Loop's
 * permission ruleset. We pass `false` for tools the agent is denied —
 * everything else stays implicit-allow. Mirrors the deny-only filter
 * `disabledTools()` produces for the main loop's tool set.
 *
 * OpenCode owns the tool implementations, so we don't pass the full
 * Loop tool list here — we only pass denials it should respect.
 *
 * Critical: Loop's tool IDs (e.g. `apply_patch`, `bash_output`) don't
 * always match OpenCode's native names (`patch`/`apply-patch`,
 * `bash-output`). `loopToolToOpenCodeNames` translates each Loop ID to the
 * one-or-more OpenCode names that should be disabled.
 */
function buildToolFilter(rulesetTools: Set<string>): Record<string, boolean> {
	const filter: Record<string, boolean> = {}
	for (const loopName of rulesetTools) {
		for (const ocName of loopToolToOpenCodeNames(loopName)) {
			filter[ocName] = false
		}
	}
	return filter
}

/**
 * Build the plan / build-switch reminder string for OpenCode's prompt.
 *
 * Mirrors `insertReminders()` in the main loop, adapted for OpenCode's
 * single-prompt model: we send the reminder as a synthetic text part
 * appended to the user's actual message. The plan agent reads it as part
 * of the user turn and stays in read-only mode; the build agent gets the
 * "switched from plan" notice with the approved plan attached.
 *
 * Returns `undefined` when no reminder applies (default agents during
 * normal turns).
 */
function buildOpenCodeReminder(
	sessionId: string,
	agentName: string,
	messages: ReadonlyArray<{ role: string; metadata?: unknown }>,
): string | undefined {
	if (agentName === "plan") {
		const path = planPath(sessionId)
		const existing = readPlan(sessionId)
		// Use the OpenCode-specific reminder. The default `buildPlanReminder`
		// instructs the model to call `plan_write` / `plan_exit`, neither of
		// which OpenCode advertises — leading to "Model tried to call
		// unavailable tool 'plan_write'" errors that waste a full turn before
		// the model recovers. The OpenCode variant tells the model to produce
		// the plan as its final assistant text; `runtime.ts` writes it to
		// disk and synthesises the plan-exit tool part at end-of-turn.
		return buildOpenCodePlanReminder(path, existing)
	}

	if (agentName === "build") {
		const wasPlan = messages.some(
			(m) =>
				m.role === "assistant" && (m.metadata as { agent?: string } | undefined)?.agent === "plan",
		)
		if (wasPlan) {
			const planContent = readPlan(sessionId)
			const switchReminder = getModeReminder("build")
			return planContent ? `${switchReminder}\n\n<plan>\n${planContent}\n</plan>` : switchReminder
		}
	}

	return undefined
}

/**
 * Convert the latest user message's file/image parts to OpenCode's
 * `FilePartInput` shape. Mirrors t3code's `toOpenCodeFileParts`: for files
 * already on disk we emit a `file://` URL; for inline content (data URLs
 * or raw bytes) we forward the URL as-is.
 *
 * Without this, screenshots and file attachments dropped on the chat
 * input never reach OpenCode — the model sees only the user's text.
 */
function buildOpenCodeFileParts(sessionId: string): Array<Record<string, unknown>> {
	const messages = queries.findMessagesBySessionId(sessionId)
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.role !== "user") continue
		const parts =
			(
				msg as {
					parts?: Array<{ type: string; path?: string; mimeType?: string; content?: string }>
				}
			).parts ?? []
		const out: Array<Record<string, unknown>> = []
		for (const p of parts) {
			if (p.type !== "file") continue
			const path = typeof p.path === "string" ? p.path : ""
			const mime = typeof p.mimeType === "string" ? p.mimeType : "application/octet-stream"
			const content = typeof p.content === "string" ? p.content : ""
			// `content` is a data URL (when uploaded inline) or empty (when the
			// path is a real file on disk). Both are valid `url` values for
			// OpenCode — it accepts file:// and data: equally.
			let url: string
			if (content.startsWith("data:")) {
				url = content
			} else if (path) {
				try {
					url = pathToFileURL(path).href
				} catch {
					url = path
				}
			} else {
				continue
			}
			const filename = path.split("/").pop() || path || "attachment"
			out.push({ type: "file", mime, filename, url })
		}
		return out
	}
	return []
}

/**
 * Resolve reasoning effort from the last user message's metadata.
 * Mirrors `extractEffort()` in claude-code/runtime.ts.
 */
function extractReasoningEffortFromMessages(sessionId: string): string | undefined {
	const messages = queries.findMessagesBySessionId(sessionId)
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.role !== "user") continue
		const meta = msg.metadata as { reasoningEffort?: string; effort?: string } | undefined
		if (meta) return meta.reasoningEffort ?? meta.effort
		break
	}
	return undefined
}

/**
 * Map Loop's reasoning effort enum to an OpenCode `variant`. OpenCode
 * uses provider-defined variant strings (typically "low"/"medium"/"high").
 * "ultrathink" is Anthropic-specific (handled by Claude Code's prompt
 * prefix), and "max"/"xhigh" don't have OpenCode counterparts — both
 * collapse to "high" so the user still gets the highest available tier.
 */
function mapEffortToVariant(effort: string | undefined): string | undefined {
	if (!effort) return undefined
	switch (effort) {
		case "low":
			return "low"
		case "medium":
			return "medium"
		case "high":
			return "high"
		case "max":
		case "xhigh":
		case "ultrathink":
			return "high"
		default:
			return undefined
	}
}

/**
 * Read the persisted text-part contents for an assistant message and
 * concatenate them. Used to capture the plan agent's final output before
 * synthesizing a plan-exit tool part — the message's own text parts are
 * the canonical source of the plan markdown.
 */
function collectAssistantText(messageId: string): string {
	const parts = queries.findPartsByMessageId(messageId)
	const out: string[] = []
	for (const p of parts) {
		const data = p.data as { type?: string; text?: string } | undefined
		if (!data || data.type !== "text") continue
		if (typeof data.text === "string" && data.text.length > 0) out.push(data.text)
	}
	return out.join("").trim()
}

function persistTextPart(sessionId: string, messageId: string, text: string): void {
	const partId = ulid()
	Database.withEffects((_tx, effect) => {
		queries.upsertPart({
			id: partId,
			sessionId,
			messageId,
			type: "text",
			data: { type: "text", text },
		})
		effect(() => {
			bus().emit("part:upsert", {
				sessionId,
				messageId,
				part: { id: partId, type: "text", text },
			})
		})
	})
}

function emitError(
	sessionId: string,
	source: "runtime" | "auth" | "cli" | "rate-limit" | "tool" | "stream" | "provider",
	message: string,
): void {
	try {
		bus().emit("session:error", {
			sessionId,
			error: { severity: "error", source, message, recoverable: false },
		})
	} catch (err) {
		log.warn("Failed to emit session:error", {
			sessionId,
			error: err instanceof Error ? err.message : String(err),
		})
	}
}

// Re-exported for the dispatcher's provider-switch cleanup paths.
export { clearResumeState as clearOpenCodeResume } from "./session"
// Re-exported for tests / runtime introspection.
export { closeAllSessionRuntimes } from "./session-runtime"
// Re-exported for tests.
export { clearResumeState }
