import { existsSync } from "node:fs"
import { ulid } from "@core/id"
import { filterCompacted } from "@core/message/compact"
import type { MessageWithParts } from "@core/schema/message"
import type { FileDiff } from "@core/schema/part"
import type { PermissionRuleset } from "@core/schema/permission"
import type { ModelSelection, SDKMessage } from "@cursor/sdk"
import { AgentRegistry } from "../../agent"
import { insertReminders } from "../../agent/prompt/inject"
import * as Database from "../../db"
import * as queries from "../../db/queries"
import { createLogger } from "../../logger"
import { resolveRuleset } from "../../permission"
import { CURSOR_PROVIDER_ID, decodeVariantId } from "../../provider/handlers/cursor"
import { ProviderRegistry } from "../../provider/registry"
import { bus } from "../../workspace/bus"
import type { PromptBody } from "../index"
import { markSessionErrorEmitted } from "../prompt"
import { snapshot } from "../snapshot"
import { setSessionStatus } from "../status"
import { ensureSessionTitle } from "../title"
import { type CursorPartEmitter, createCursorAdapter } from "./adapter"
import { clearCursorResume, readCursorResumeState, resolveCursorResume } from "./session"
import {
	cancelCurrentRun,
	closeCursorSessionRuntime,
	ensureCursorAgent,
	setCurrentRun,
} from "./session-runtime"
import { cursorPromptSignature } from "./system-prompt"

/**
 * Cursor SDK runtime for Loop sessions.
 *
 * Each Loop session owns one `SDKAgent` (see `session-runtime.ts`) that
 * persists across turns. A turn calls `agent.send(prompt)` which returns
 * a `Run`; the runtime iterates `run.stream()`, drives the adapter, then
 * `run.wait()`s for the terminal status. Cursor handles its own tool
 * loop internally — Loop renders the events and never re-invokes the
 * agent for tool results.
 */

const log = createLogger("cursor-runtime")

interface ResolvedAuth {
	apiKey: string
}

interface NormalizedUsage {
	input: number
	output: number
	reasoning?: number
	cacheRead?: number
	cacheWrite?: number
}

/**
 * Extract token usage from Cursor's `RunResult`. The SDK type currently
 * doesn't declare `usage`, but the runtime carries it in practice — the
 * cookbook reads it via the same defensive cast. We normalize whatever
 * field names the SDK happens to use today (`inputTokens` vs `input`)
 * into Loop's StepUsage shape so the UsageBar renders correctly.
 *
 * Returns undefined when no usable counts are present so the runtime can
 * skip the `session:usage` emit instead of broadcasting zeros.
 */
function extractCursorUsage(result: unknown): NormalizedUsage | undefined {
	if (!result || typeof result !== "object") return undefined
	const usage = (result as { usage?: unknown }).usage
	if (!usage || typeof usage !== "object") return undefined
	const u = usage as Record<string, unknown>
	const num = (...keys: string[]): number => {
		for (const key of keys) {
			const v = u[key]
			if (typeof v === "number" && Number.isFinite(v)) return v
		}
		return 0
	}
	const input = num("input", "inputTokens", "promptTokens")
	const output = num("output", "outputTokens", "completionTokens")
	if (input === 0 && output === 0) return undefined
	const reasoning = num("reasoning", "reasoningTokens", "thinkingTokens")
	const cacheRead = num("cacheRead", "cacheReadTokens", "cacheReadInputTokens")
	const cacheWrite = num("cacheWrite", "cacheWriteTokens", "cacheCreationTokens")
	const out: NormalizedUsage = { input, output }
	if (reasoning > 0) out.reasoning = reasoning
	if (cacheRead > 0) out.cacheRead = cacheRead
	if (cacheWrite > 0) out.cacheWrite = cacheWrite
	return out
}

/**
 * Hard cap on the synthetic-handoff chain depth. A tool like `plan_exit`
 * creates a synthetic user message that re-fires the cursor loop with a
 * different agent; the same chain CAN happen again (e.g., the new agent
 * also exits its mode), so we recurse — but a runaway chain would tie up
 * the worker indefinitely. 5 is more than any sane chain.
 */
const MAX_SYNTHETIC_HANDOFF_DEPTH = 5

/**
 * Cookbook's short instruction block. Cursor's SDK already injects its own
 * system prompt with the full built-in tool registry (Read, Glob, Grep,
 * Shell, Edit, Write, Ls, ...). All we add is a terse persona reminder so
 * the agent knows it's a coding helper. Matches
 * `cookbook/sdk/coding-agent-cli/src/agent.ts::AGENT_INSTRUCTIONS`.
 */
const CURSOR_AGENT_INSTRUCTIONS = [
	"You are a lightweight coding agent running inside Loop.",
	"Work in the configured workspace.",
	"Help the user inspect, edit, and validate code with small focused changes.",
	"Before changing files, understand the surrounding code and preserve unrelated user work.",
	"Keep progress updates concise and summarize the result clearly.",
].join("\n")

/**
 * Build the prompt text that gets shipped to `agent.send()`. Mirrors the
 * cookbook's `buildPrompt`:
 *   `[AGENT_INSTRUCTIONS, "", "User task:", prompt].join("\n")`
 *
 * If the active agent ships its own persona (plan / explore / universal),
 * prepend that as an additional instruction block so the persona applies
 * without the bulk of Loop's full system-prompt assembly.
 */
function buildCursorSendText(args: {
	agent: { name: string; prompt?: string }
	userPrompt: string
}): string {
	const persona = args.agent.prompt?.trim()
	const instructions = persona
		? `${persona}\n\n${CURSOR_AGENT_INSTRUCTIONS}`
		: CURSOR_AGENT_INSTRUCTIONS
	return `${instructions}\n\nUser task:\n${args.userPrompt}`
}

/**
 * Entry point for Cursor turns. Called by `runSession` (`dispatch.ts`)
 * when the resolved provider is `cursor`.
 *
 * `_handoffDepth` is INTERNAL — bumped only when we recurse to handle a
 * synthetic user message produced by a tool (plan_exit etc). Callers from
 * outside this module should leave it unset.
 */
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

	// Resolve the effective permission ruleset. Cursor's built-in tools
	// can't be filtered at the SDK boundary today (passing `mcpServers` /
	// `agents` to Agent.create breaks tool registration — see
	// session-runtime.ts), so the ruleset is informational here: it
	// drives the prompt-signature for cache-invalidation and lets future
	// changes re-introduce a tool-policy section without restructuring.
	const sessionRulesetRaw = (session as { permission?: unknown }).permission
	const sessionRuleset = Array.isArray(sessionRulesetRaw)
		? (sessionRulesetRaw as PermissionRuleset)
		: undefined
	const sessionPermissionMode = (session as { permissionMode?: string }).permissionMode
	const ruleset = resolveRuleset(agent.permission, sessionPermissionMode, sessionRuleset)

	// Build the per-turn message view that drives system-prompt assembly +
	// reminder injection. Mirrors what runLoop does for the AI SDK path:
	//   1. load DB messages, filter at the last compaction boundary,
	//   2. call insertReminders to mutate the last user message with the
	//      agent's mode-specific reminders (plan vs build, queued user
	//      messages, etc.),
	//   3. extract the final user text (now including any synthetic parts)
	//      to ship to the Cursor SDK.
	const rawMessages = queries.findMessagesBySessionId(sessionId) as MessageWithParts[]
	const messages = filterCompacted(rawMessages)
	insertReminders({ messages, agent, sessionId })
	const userPrompt = extractFinalUserPrompt(messages)
	if (!userPrompt) throw new Error("No user prompt text found for Cursor turn")

	const auth = await resolveAuth()
	if (!auth) {
		const msg =
			"Cursor SDK is not authenticated. Add a CURSOR_API_KEY in Settings → Providers (get one from cursor.com/dashboard/integrations)."
		emitSessionError(sessionId, "error", "auth", msg, undefined, false)
		const err = new Error(msg)
		markSessionErrorEmitted(err)
		throw err
	}

	// Pick the cwd. We never call Agent.resume (see session-runtime.ts for
	// the rationale), so we only need the cwd here — the persisted
	// `cursorAgentId` is informational. We still walk the resume state to
	// purge any agentId left behind by older builds: that purge prevents
	// the runtime from re-attempting resume if the no-resume policy ever
	// gets reverted, and keeps the session row tidy.
	const resumeState = readCursorResumeState(sessionId)
	const { cwd } = resolveCwdAndResume(sessionId, session.directory, resumeState)
	if (resumeState.cursorAgentId) {
		clearCursorResume(sessionId)
	}

	const modelSelection = toModelSelection(modelRef.modelId, body)

	// Open the assistant message placeholder before any SDK activity so
	// the UI has something to render the first delta into.
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

	// Pre-turn snapshot for the edit diff at the end.
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
	const adapter = createCursorAdapter({
		emitter,
		// onAgentId is intentionally a no-op now: we don't resume agents
		// (see session-runtime.ts), so persisting the SDK's agentId
		// would just leave dead data on the session row. If resume is
		// ever re-enabled, wire `persistCursorResume` back in here.
		onActive: () => {
			// Safety net: if the busy event from setSessionStatus was lost
			// (RAF coalescing / SSE drop), re-assert busy on first model
			// activity. Mirrors claude-code/runtime.ts onMainAgentActive.
			setSessionStatus(sessionId, "busy")
		},
	})

	adapter.beginTurn(preSnapshotHash)

	let abortHandler: (() => void) | undefined
	if (signal.aborted) {
		await cancelCurrentRun(sessionId)
	} else {
		abortHandler = () => {
			log.info("Aborting Cursor turn", { sessionId })
			void cancelCurrentRun(sessionId)
		}
		signal.addEventListener("abort", abortHandler, { once: true })
	}

	let finishOverride: string | undefined
	let runtimeError: Error | undefined
	let runResult:
		| {
				durationMs?: number
				resolvedModelId?: string
				usage?: NormalizedUsage
		  }
		| undefined

	try {
		const runtime = await ensureCursorAgent({
			sessionId,
			apiKey: auth.apiKey,
			cwd,
			model: modelSelection,
			name: session.title ?? undefined,
		})

		// We deliberately don't persist `runtime.agent.agentId` to the
		// session row. With `Agent.resume` disabled, that ID is never
		// read back; storing it would just leave stale data on a fresh
		// turn. The agent lives in `cursorRuntimes` (workspace-scoped
		// state) for the lifetime of this server process, which is the
		// same reuse window the cookbook gets from a single CLI
		// invocation.

		// Match the cookbook's `buildPrompt` exactly. The Cursor SDK has its
		// own internal system prompt that already wires the built-in tools
		// (Read/Glob/Grep/Shell/Edit/...) — wrapping the user's task in
		// Loop's full assembleSystemPrompt (model header + AGENTS.md +
		// CLAUDE.md + skills + MCP catalog + tool-policy block) drowns
		// the actual task and was empirically observed to make Cursor's
		// tools return empty results. Keep the prefix tiny and let
		// Cursor's own system prompt handle tool routing.
		//
		// If a non-default agent has its own `prompt` (plan, explore,
		// universal, ...) we surface it as a short prefix so the agent's
		// persona still applies. Default agent uses the cookbook's terse
		// instruction list.
		const sendText = buildCursorSendText({ agent, userPrompt })

		const run = await runtime.agent.send(sendText, { model: modelSelection })
		runtime.systemPromptInjected = true
		runtime.anchoredPromptSignature = cursorPromptSignature({
			agent,
			modelId: modelRef.modelId,
			ruleset,
		})
		setCurrentRun(sessionId, run)

		try {
			for await (const event of run.stream() as AsyncIterable<SDKMessage>) {
				adapter.handle(event)
			}
			// `run.wait()` resolves with the terminal RunResult after the
			// stream's last SDKMessage. Status maps directly to Loop's finish
			// reason; durationMs / model are surfaced for observability.
			const result = await run.wait()
			if (result.status === "cancelled") finishOverride = "abort"
			else if (result.status === "error") finishOverride = "error"
			const usage = extractCursorUsage(result)
			runResult = {
				durationMs: result.durationMs,
				resolvedModelId: result.model?.id,
				usage,
			}
			// Surface usage to the frontend's UsageBar. Cursor's pricing
			// is API-managed (zeroes in ModelInfo) so cost is always 0;
			// the contextWindow comes from Loop's provider registry —
			// `getModelInfo` doesn't trigger the unreachable createModel
			// stub, so this is safe for cursor models.
			if (usage) {
				const info = ProviderRegistry.getModelInfo(modelRef.providerId, modelRef.modelId)
				const contextWindow = info?.contextWindow ?? 0
				try {
					bus().emit("session:usage", {
						sessionId,
						usage,
						cost: 0,
						contextWindow,
					})
				} catch (err) {
					log.warn("Failed to emit session:usage", {
						sessionId,
						error: err instanceof Error ? err.message : String(err),
					})
				}
			}
		} finally {
			setCurrentRun(sessionId, undefined)
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
			if (category.kind === "auth") {
				// API key / auth failures invalidate the cached SDKAgent —
				// drop persisted state so the next turn re-creates fresh.
				clearCursorResume(sessionId)
				await closeCursorSessionRuntime(sessionId)
			} else if (category.kind === "unknown-agent") {
				// SDK lost track of the persisted agentId. Clear the cursor
				// so the next turn does a clean Agent.create instead of
				// thrashing on resume.
				clearCursorResume(sessionId)
				await closeCursorSessionRuntime(sessionId)
			}
		} else {
			finishOverride = "abort"
		}
	} finally {
		if (abortHandler) signal.removeEventListener("abort", abortHandler)
	}

	await finalizeTurn({
		sessionId,
		messageId: assistantMessageId,
		agentName,
		modelRef,
		preSnapshotHash,
		adapterFinalize: adapter.finalize.bind(adapter),
		overrideFinish: signal.aborted ? "abort" : finishOverride,
		runResult,
	})

	if (runtimeError && !signal.aborted) throw runtimeError

	// Synthetic-message handoff: if a tool persisted a new user message with
	// `metadata.synthetic` (e.g. plan_exit creates a synthetic user message
	// to switch from "plan" to "build"), re-fire the cursor loop with the
	// updated message history. Mirrors the AI-SDK loop's `continue` at
	// loop/index.ts:577-590, but expressed as recursion because Cursor turns
	// don't run inside a while-loop.
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
		// New agent / model will be resolved on the next turn from the
		// synthetic message's metadata. The runtime cache stays — the
		// promptSignature mismatch will trigger re-anchor automatically.
		await runCursorLoop(sessionId, signal, body, _handoffDepth + 1)
	}
}

// ─── Helpers ────────────────────────────────────────────────────────

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
	runResult: { durationMs?: number; resolvedModelId?: string; usage?: NormalizedUsage } | undefined
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
			result = args.adapterFinalize({
				snapshotHash: preSnapshotHash,
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
			queries.updateMessage(messageId, {
				metadata: {
					modelId: modelRef.modelId,
					providerId: modelRef.providerId,
					agent: agentName,
					finish: args.overrideFinish ?? result?.finishReason ?? "stop",
					...(args.runResult?.durationMs !== undefined
						? { durationMs: args.runResult.durationMs }
						: {}),
					...(args.runResult?.resolvedModelId
						? { resolvedModelId: args.runResult.resolvedModelId }
						: {}),
					...(args.runResult?.usage ? { tokens: args.runResult.usage } : {}),
					// Cursor's pricing is API-managed; cost is always 0 in
					// Loop's accounting. Persist explicitly so the UsageBar
					// re-derives the same number on reload.
					cost: 0,
					...(info?.contextWindow ? { contextWindow: info.contextWindow } : {}),
				},
			})
		} catch (err) {
			log.warn("updateMessage threw", {
				sessionId,
				error: err instanceof Error ? err.message : String(err),
			})
		}

		void ensureSessionTitle({ sessionId }).catch((err) =>
			log.warn("ensureSessionTitle errored", {
				sessionId,
				error: err instanceof Error ? err.message : String(err),
			}),
		)
	} finally {
		setSessionStatus(sessionId, "idle")
	}
}

/** Same chain as the dispatcher: body → last user message metadata → "build". */
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
	// Fall back to body.model even if it isn't tagged cursor — the dispatch
	// already routed us here based on the resolved providerId, so trust that.
	return body?.model
}

/**
 * Extract the final user prompt text from a list of messages that has
 * already been mutated by `insertReminders`. Walks back to the last user
 * message and joins its text parts (including synthetic reminder parts —
 * those are how Loop injects plan-mode constraints, build-switch reminders,
 * and queued-message wrappers).
 */
function extractFinalUserPrompt(messages: MessageWithParts[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.role !== "user") continue
		const parts = msg.parts ?? []
		const text = parts
			.filter((p) => p.type === "text")
			.map((p) => ("text" in p && typeof p.text === "string" ? p.text : ""))
			.filter((t) => t.length > 0)
			.join("\n\n")
			.trim()
		if (text) return text
		break
	}
	return undefined
}

function resolveCwdAndResume(
	sessionId: string,
	sessionDirectory: string,
	state: ReturnType<typeof readCursorResumeState>,
): { cwd: string; resumeAgentId?: string } {
	const cursor = resolveCursorResume(state)
	if (cursor.shouldResume && state.cursorCwd && existsSync(state.cursorCwd)) {
		return { cwd: state.cursorCwd, resumeAgentId: cursor.agentId }
	}
	if (state.cursorAgentId) {
		log.info("Clearing stale Cursor resume cursor", {
			sessionId,
			reason: cursor.reason ?? "cwd missing",
		})
		clearCursorResume(sessionId)
	}
	return { cwd: sessionDirectory }
}

/**
 * Build the SDK's `ModelSelection` from Loop's flat model id.
 *
 * Loop's picker uses ids of the form `<baseId>` for the canonical model
 * or `<baseId>:<key>=<value>&...` for a specific variant. The Cursor SDK
 * rejects anything outside its registered base id list, so we MUST split
 * the encoded form back into `{ id: baseId, params }` before sending.
 * `decodeVariantId` is the inverse of `encodeVariantId` in the provider
 * handler.
 *
 * Compat: the prior CLI-based handler emitted ids like `composer-2-fast`
 * (a CLI-only modifier with no SDK equivalent). Sessions persisted before
 * the SDK rewrite may still carry such ids in their last user message's
 * metadata. We strip a trailing `-fast` here so those sessions survive
 * one more turn without forcing the user to re-pick. Other modifiers
 * (`-max`, `-thinking-max`, `-medium`, etc.) are NOT auto-stripped because
 * they collide with canonical base ids like `gpt-5.4-mini` or
 * `gpt-5.1-codex-max`.
 */
function toModelSelection(modelId: string, _body: PromptBody | undefined): ModelSelection {
	const decoded = decodeVariantId(modelId)
	const baseId = decoded.baseId.endsWith("-fast")
		? decoded.baseId.slice(0, -"-fast".length)
		: decoded.baseId
	return decoded.params.length > 0 ? { id: baseId, params: decoded.params } : { id: baseId }
}

/** Resolve API key from env or AuthManager (delegated to the provider handler). */
async function resolveAuth(): Promise<ResolvedAuth | undefined> {
	const { resolveCursorApiKey } = await import("../../provider/handlers/cursor")
	const apiKey = await resolveCursorApiKey()
	if (!apiKey) return undefined
	return { apiKey }
}

interface ErrorCategory {
	kind: "auth" | "rate-limit" | "unknown-agent" | "network" | "unknown"
	source: "auth" | "rate-limit" | "stream" | "provider" | "runtime"
	recoverable: boolean
	userMessage?: string
}

/**
 * Map a runtime error to a category that drives:
 *   - The session:error `source` chip in the UI banner
 *   - Whether to clear cached SDKAgent state (auth, unknown-agent)
 *   - The `recoverable` flag exposed to the frontend
 *
 * Cursor SDK exposes named subclasses (`AuthenticationError`,
 * `RateLimitError`, `UnknownAgentError`, ...). We `instanceof`-check via
 * constructor name to avoid pinning to specific export paths that shift
 * across SDK versions.
 */
function categorizeCursorError(err: Error): ErrorCategory {
	const ctor = err.constructor?.name ?? ""
	const msg = err.message.toLowerCase()

	if (
		ctor === "AuthenticationError" ||
		msg.includes("api key") ||
		msg.includes("401") ||
		msg.includes("unauthorized") ||
		msg.includes("authentication")
	) {
		return {
			kind: "auth",
			source: "auth",
			recoverable: false,
			userMessage: "Cursor SDK rejected the API key. Update it in Settings → Providers and retry.",
		}
	}
	if (ctor === "RateLimitError" || msg.includes("429") || msg.includes("rate limit")) {
		return {
			kind: "rate-limit",
			source: "rate-limit",
			recoverable: true,
			userMessage: "Cursor rate limit hit. Wait a moment and retry the prompt.",
		}
	}
	if (
		ctor === "UnknownAgentError" ||
		msg.includes("unknown agent") ||
		msg.includes("agent not found")
	) {
		return {
			kind: "unknown-agent",
			source: "provider",
			recoverable: true,
			userMessage:
				"Cursor lost the resumed agent (likely cleared `.cursor/`). Retrying creates a fresh one.",
		}
	}
	if (
		ctor === "NetworkError" ||
		msg.includes("etimedout") ||
		msg.includes("econnreset") ||
		msg.includes("fetch failed")
	) {
		return {
			kind: "network",
			source: "stream",
			recoverable: true,
			userMessage: "Network error talking to Cursor. Retry the prompt.",
		}
	}
	return { kind: "unknown", source: "stream", recoverable: true }
}

/**
 * Build the part emitter the adapter uses. Pins each partId to its first
 * messageId so a late update event still routes to the original message.
 * Mirrors createPartEmitter in claude-code/session-runtime.ts.
 */
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
