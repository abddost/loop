import { existsSync } from "node:fs"
import { ulid } from "@core/id"
import type { FileDiff } from "@core/schema/part"
import { AgentRegistry } from "../../agent"
import * as Database from "../../db"
import * as queries from "../../db/queries"
import { createLogger } from "../../logger"
import { detectClaudeCode } from "../../provider/claude-code/detect"
import {
	applyUltrathinkPrefix,
	resolveApiModelId,
	resolveEffort,
} from "../../provider/claude-code/models"
import { bus } from "../../workspace/bus"
import type { PromptBody } from "../index"
import { markSessionErrorEmitted } from "../prompt"
import { snapshot } from "../snapshot"
import { getSessionStatus, setSessionStatus } from "../status"
import { registerActiveQuery, unregisterActiveQuery } from "./active-queries"
import type { createClaudeCodeAdapter } from "./adapter"
import { markTaskFinished, markTaskStarted } from "./pending-tasks"
import { resolveSdkPermissionMode } from "./prompts"
import {
	clearResumeCursor,
	persistResumeCursor,
	readResumeState,
	resolveResumeCursor,
} from "./session"
import {
	closeSessionRuntime,
	ensureSessionRuntime,
	getSessionRuntime,
	interruptCurrentTurn,
	startTurn,
} from "./session-runtime"

/**
 * Claude Code runtime for Loop sessions.
 *
 * Each session owns a single long-lived SDK `query()` (see
 * `session-runtime.ts`) whose `prompt` is an async queue. Turns push a
 * user message onto the queue and await the SDK's `result` event; the
 * query stays open in between, so background subagent notifications
 * (`task_notification` for `run_in_background` Agent tools) arrive
 * naturally and update their already-rendered Subagent parts in place.
 *
 * This mirrors t3code's architecture and replaces Loop's earlier
 * per-turn query + polling-based follow-up, which dropped notifications
 * whenever the turn closed before the background work finished.
 */

const log = createLogger("claude-code-runtime")

/**
 * Entry point for Claude Code turns. Called by `runSession` (`dispatch.ts`)
 * when the resolved provider is `claude-code`.
 */
export async function runClaudeCodeLoop(
	sessionId: string,
	signal: AbortSignal,
	body?: PromptBody,
): Promise<void> {
	// ─── 1. Load session + agent + model ─────────────────────────
	const session = queries.findSessionById(sessionId)
	if (!session) throw new Error(`Session not found: ${sessionId}`)

	const agentName = resolveAgentName(sessionId, body)
	if (!AgentRegistry.get(agentName)) throw new Error(`Agent not found: ${agentName}`)

	const modelRef = resolveClaudeCodeModel(sessionId, body)
	if (!modelRef) {
		throw new Error(
			"Claude Code turn missing a model reference. Select a Claude Code model before sending.",
		)
	}

	// ─── 2. Build the prompt text from the last user message ─────
	let promptText = extractLastUserPromptText(sessionId)
	if (!promptText) {
		throw new Error("No user prompt text found for Claude Code turn")
	}

	// ─── 3. Detect the CLI ──────────────────────────────────────
	const detection = await detectClaudeCode()
	if (!detection.installed) {
		const msg =
			"Claude Code CLI is not installed. Install it from https://docs.anthropic.com/en/docs/claude-code and try again."
		emitSessionError(sessionId, "error", "cli", msg, undefined, false)
		const err = new Error(msg)
		markSessionErrorEmitted(err)
		throw err
	}
	if (!detection.authenticated) {
		const msg =
			"Claude Code CLI is installed but not authenticated. Run `claude login` in your terminal."
		emitSessionError(sessionId, "error", "auth", msg, undefined, false)
		const err = new Error(msg)
		markSessionErrorEmitted(err)
		throw err
	}

	// ─── 4. Pick the cwd and validate it still exists ───────────
	const resumeState = readResumeState(sessionId)
	const { cwd, resume } = resolveCwdAndResume(sessionId, session.directory, resumeState)

	// ─── 5. Resolve permissions ─────────────────────────────────
	// The session's permission mode is forwarded to the SDK as-is. Claude
	// Code's built-in persona handles everything else.
	const sessionPermissionMode = (session.permissionMode as string) ?? "default"
	const sdkPermMode = resolveSdkPermissionMode(sessionPermissionMode)
	const bypassPermissions = sdkPermMode === "bypassPermissions"

	// ─── 6. Create the assistant message placeholder ────────────
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

	// ─── 7. Capture the pre-turn snapshot ───────────────────────
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

	// ─── 8. Ensure the session-scoped SDK query is live ─────────
	const bodyEffort = extractEffort(sessionId, body)
	const { sdkEffort, isUltrathink } = resolveEffort(bodyEffort, modelRef.modelId)
	const apiModelId = resolveApiModelId(modelRef.modelId)

	const sessionRuleset = Array.isArray(session.permission)
		? (session.permission as import("@core/schema/permission").PermissionRuleset)
		: []

	const runtime = await ensureSessionRuntime({
		sessionId,
		cwd,
		binaryPath: detection.binaryPath ?? "",
		apiModelId,
		sdkPermMode,
		sdkEffort,
		resume,
		sessionRuleset,
		bypassPermissions,
		onSessionId: (sdkSessionId) => {
			persistResumeCursor(sessionId, {
				claudeCodeSessionId: sdkSessionId,
				claudeCodeCwd: cwd,
			})
		},
		onCompactBoundary: () => {
			Database.withEffects((_tx, effect) => {
				queries.updateSession(sessionId, { compactedAt: Date.now() })
				effect(() => {
					bus().emit("session:update", {
						sessionId,
						session: queries.findSessionById(sessionId),
					})
				})
			})
		},
		onAuthFailure: (message) => {
			log.warn("Claude Code auth failure", { sessionId, message })
			clearResumeCursor(sessionId)
			emitSessionError(sessionId, "error", "auth", message, undefined, true)
			// Auth failure kills the session — the next turn needs a fresh CLI process.
			void closeSessionRuntime(sessionId)
		},
		onTaskStarted: (info) => markTaskStarted(sessionId, info),
		onTaskFinished: (taskId) => markTaskFinished(sessionId, taskId),
		onMainAgentActive: () => {
			// Safety net: when the main agent starts streaming, re-assert busy.
			// Covers rare SSE drop / RAF-coalesce cases where the original
			// `busy` event set at turn start didn't land on the client. Only
			// overwrites terminal states — we must not clobber
			// `awaiting-permission` / `awaiting-question` / `compacting` or
			// the UI will dismiss the dialog.
			const current = getSessionStatus(sessionId)
			if (current === "idle") {
				setSessionStatus(sessionId, "busy")
			}
		},
	})

	// Permission mode may have changed since the runtime was last built —
	// propagate it into the live query. `setPermissionMode` is a no-op if
	// the mode hasn't changed.
	if (runtime.queryRef.setPermissionMode) {
		try {
			await runtime.queryRef.setPermissionMode(sdkPermMode)
		} catch (err) {
			log.warn("Failed to apply permission mode to live query", {
				sessionId,
				error: err instanceof Error ? err.message : String(err),
			})
		}
	}

	// Prepare the adapter for this turn (new messageId + snapshot hash).
	runtime.currentMessageId = assistantMessageId
	runtime.adapter.beginTurn(preSnapshotHash)

	// Expose the query handle to the permission route so it can forward
	// mode changes from the UI mid-turn.
	registerActiveQuery(sessionId, {
		setPermissionMode: async (mode) => {
			if (runtime.queryRef.setPermissionMode) {
				await runtime.queryRef.setPermissionMode(mode)
			}
		},
	})

	// ─── 9. Wire abort ──────────────────────────────────────────
	// User cancellation interrupts the current turn via the SDK. We
	// also fully close the session runtime so the next user prompt
	// starts a fresh subprocess — matches the prior per-turn abort
	// semantics and avoids a hung background CLI after cancel.
	let abortHandler: (() => void) | undefined
	if (signal.aborted) {
		await interruptCurrentTurn(sessionId)
		await closeSessionRuntime(sessionId)
	} else {
		abortHandler = () => {
			log.info("Aborting Claude Code turn", { sessionId })
			void interruptCurrentTurn(sessionId).then(() => closeSessionRuntime(sessionId))
		}
		signal.addEventListener("abort", abortHandler, { once: true })
	}

	// Apply ultrathink prompt prefix if selected (prompt-injected, not an API param).
	if (isUltrathink) {
		promptText = applyUltrathinkPrefix(promptText)
	}

	// ─── 10. Push the user prompt and wait for `result` ─────────
	try {
		await startTurn(runtime, assistantMessageId, promptText)
	} catch (err) {
		if (!signal.aborted) {
			log.error("Claude Code runtime error", {
				sessionId,
				error: err instanceof Error ? err.message : String(err),
			})
			const message = err instanceof Error ? err.message : String(err)
			const stack = err instanceof Error ? err.stack : undefined
			emitSessionError(sessionId, "error", "stream", message, stack, true)
			markSessionErrorEmitted(err)
			persistErrorAsPart(sessionId, assistantMessageId, err)
			await finalizeTurn(
				sessionId,
				assistantMessageId,
				agentName,
				modelRef,
				preSnapshotHash,
				"error",
			)
			throw err
		}
	} finally {
		if (abortHandler) signal.removeEventListener("abort", abortHandler)
		unregisterActiveQuery(sessionId)
	}

	// ─── 11. Finalize ───────────────────────────────────────────
	await finalizeTurn(
		sessionId,
		assistantMessageId,
		agentName,
		modelRef,
		preSnapshotHash,
		signal.aborted ? "abort" : undefined,
	)
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Emit a `session:error` bus event so the frontend can render the
 * thread-error banner. Best-effort — never throws.
 */
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

/**
 * Persist a runtime failure as a trailing text part so the user sees the
 * error in the timeline. Matches the `prompt.ts` error-persistence pattern.
 */
function persistErrorAsPart(sessionId: string, messageId: string, err: unknown): void {
	const text = err instanceof Error ? err.message : String(err)
	const partId = ulid()
	Database.withEffects((_tx, effect) => {
		queries.upsertPart({
			id: partId,
			sessionId,
			messageId,
			type: "text",
			data: { type: "text", text: `Claude Code runtime error: ${text}` },
		})
		effect(() => {
			bus().emit("part:upsert", {
				sessionId,
				messageId,
				part: { id: partId, type: "text", text: `Claude Code runtime error: ${text}` },
			})
		})
	})
}

/**
 * Flush any stragglers for the ended turn, emit step-finish + edit
 * parts, and update the assistant message's finish metadata. The
 * adapter is session-scoped (per `ensureSessionRuntime`) so `finalize`
 * here closes the turn without tearing down the cross-turn task
 * registry.
 */
async function finalizeTurn(
	sessionId: string,
	messageId: string,
	agentName: string,
	modelRef: { modelId: string; providerId: string },
	preSnapshotHash: string | undefined,
	overrideFinish?: string,
): Promise<void> {
	try {
		const runtime = getSessionRuntime(sessionId)
		const adapter: ReturnType<typeof createClaudeCodeAdapter> | undefined = runtime?.adapter

		// Capture the post-run snapshot + compute a diff for the edit part.
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

		let result: ReturnType<NonNullable<typeof adapter>["finalize"]> | undefined
		try {
			result = adapter?.finalize({
				snapshotHash: preSnapshotHash,
				editFiles,
			})
		} catch (err) {
			log.warn("Adapter finalize threw — continuing to mark session idle", {
				sessionId,
				error: err instanceof Error ? err.message : String(err),
			})
		}

		try {
			queries.updateMessage(messageId, {
				metadata: {
					modelId: modelRef.modelId,
					providerId: modelRef.providerId,
					agent: agentName,
					finish: overrideFinish ?? result?.finishReason ?? "stop",
				},
			})
		} catch (err) {
			log.warn("updateMessage threw — continuing to mark session idle", {
				sessionId,
				error: err instanceof Error ? err.message : String(err),
			})
		}

		// Title generation on the first assistant turn — matches the
		// AI-SDK-path behaviour in `loop/index.ts` but uses a local
		// heuristic instead of a model call, since the synthetic
		// `claude-code` provider isn't registered with ProviderRegistry.
		maybeGenerateTitle(sessionId)
	} finally {
		// Always mark the session idle so the UI status indicator clears
		// even if any of the steps above threw. Without this, a transient
		// snapshot/DB error leaves the sidebar dot spinning forever.
		setSessionStatus(sessionId, "idle")
	}
}

/**
 * Set a session title on the first assistant turn when none is set yet.
 *
 * The shared `generateTitle` helper routes through `ProviderRegistry`,
 * which doesn't register the synthetic `claude-code` provider — calling
 * it with a claude-code modelRef would throw. Since claude-code sessions
 * don't reliably have AI SDK credentials configured, we derive a short
 * title from the first real user message instead. Deterministic, no
 * extra tokens, and the sidebar stops saying "Untitled" immediately.
 */
function maybeGenerateTitle(sessionId: string): void {
	try {
		const currentSession = queries.findSessionById(sessionId)
		if (!currentSession || currentSession.title) return
		const msgs = queries.findMessagesBySessionId(sessionId)
		const firstUser = msgs.find((m) => m.role === "user" && !isSyntheticUserMessage(m))
		if (!firstUser) return

		const derived = deriveTitleFromUserMessage(firstUser)
		if (!derived) return

		queries.updateSession(sessionId, { title: derived })
		const updated = queries.findSessionById(sessionId)
		bus().emit("session:update", { sessionId, session: updated })
	} catch (err) {
		log.warn("maybeGenerateTitle errored", {
			sessionId,
			error: err instanceof Error ? err.message : String(err),
		})
	}
}

/**
 * Extract a short, human-readable title from a user message's text parts.
 * Strips whitespace, collapses newlines, and caps at 50 chars on a word
 * boundary. Returns undefined if no text is available.
 */
function deriveTitleFromUserMessage(msg: {
	parts?: Array<{ type?: string; text?: string }>
}): string | undefined {
	const parts = msg.parts ?? []
	const text = parts
		.filter((p) => p.type === "text" && typeof p.text === "string")
		.map((p) => p.text ?? "")
		.join(" ")
		.replace(/\s+/g, " ")
		.trim()
	if (!text) return undefined
	if (text.length <= 50) return text
	const truncated = text.slice(0, 50)
	const lastSpace = truncated.lastIndexOf(" ")
	return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated).trimEnd()
}

/** True if every text part in this user message is marked synthetic. */
function isSyntheticUserMessage(msg: {
	parts?: Array<{ type?: string; synthetic?: boolean }>
}): boolean {
	const parts = msg.parts ?? []
	if (parts.length === 0) return false
	return parts.every((p) => p.type === "text" && p.synthetic === true)
}

/**
 * Find the agent name for this turn. Mirrors `runLoop.resolveAgentName` —
 * last user message metadata → body → "build".
 */
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

/**
 * Resolve the model ref for this turn. Same chain as the dispatcher:
 * body → last user message metadata → agent default.
 */
function resolveClaudeCodeModel(
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
	const agentName = body?.agent ?? "build"
	const agent = AgentRegistry.get(agentName)
	return agent?.model
}

/**
 * Collect plain-text content for the SDK prompt string from the last
 * user message.
 */
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

/**
 * Pick the cwd for the SDK call. Prefers a stored `claudeCodeCwd` when
 * it still exists on disk (resume path); falls back to
 * `session.directory` and resets the resume cursor when the old cwd
 * has been removed.
 */
function resolveCwdAndResume(
	sessionId: string,
	sessionDirectory: string,
	state: ReturnType<typeof readResumeState>,
): { cwd: string; resume?: string } {
	const cursor = resolveResumeCursor(state)

	if (cursor.shouldResume && state.claudeCodeCwd && existsSync(state.claudeCodeCwd)) {
		return { cwd: state.claudeCodeCwd, resume: cursor.resumeSessionId }
	}

	if (state.claudeCodeSessionId) {
		log.info("Clearing stale Claude Code resume cursor", {
			sessionId,
			reason: cursor.reason ?? "cwd missing",
		})
		clearResumeCursor(sessionId)
	}

	return { cwd: sessionDirectory }
}

/**
 * Extract the effort level from the prompt body or the last user
 * message metadata. Resolution chain (earliest wins):
 *   1. Explicit `body.effort` override
 *   2. Last user message metadata `.effort` or `.reasoningEffort`
 *   3. undefined → SDK/model default applies
 */
function extractEffort(sessionId: string, body: PromptBody | undefined): string | undefined {
	if (body?.effort) return body.effort

	const messages = queries.findMessagesBySessionId(sessionId)
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.role !== "user") continue
		const meta = msg.metadata as {
			effort?: string
			reasoningEffort?: string
		} | null
		if (meta) return meta.effort ?? meta.reasoningEffort
		break
	}

	return undefined
}
