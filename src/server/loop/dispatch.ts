import type { MessageWithParts } from "@core/schema/message"
import { AgentRegistry } from "../agent"
import * as queries from "../db/queries"
import { createLogger } from "../logger"
import { CLAUDE_CODE_PROVIDER_ID } from "../provider/claude-code/models"
import { CURSOR_PROVIDER_ID } from "../provider/handlers/cursor"
import { OPENCODE_PROVIDER_ID } from "../provider/opencode/constants"
import { runClaudeCodeLoop } from "./claude-code/runtime"
import { clearResumeCursor, readResumeState } from "./claude-code/session"
import { runCursorLoop } from "./cursor/runtime"
import { clearCursorResume, readCursorResumeState } from "./cursor/session"
import { type PromptBody, runLoop } from "./index"
import { runOpenCodeLoop } from "./opencode/runtime"
import { clearResumeState as clearOpenCodeResume } from "./opencode/session"

const log = createLogger("dispatch")

/**
 * Resolve the effective model reference for a session turn.
 *
 * Model resolution chain (earliest wins):
 *   1. Explicit `body.model` (the current prompt's override)
 *   2. Last user message's `metadata.model` (carries over across turns
 *      within the same session — mirrors the agent-sticky pattern in
 *      `resolveAgentName` over in `index.ts`)
 *   3. The active agent's default model
 *
 * Returns `undefined` if none of the layers provide a model — in that case
 * the downstream runtime will error out with its own message.
 */
function resolveModelRef(
	messages: MessageWithParts[],
	body: PromptBody | undefined,
): { modelId: string; providerId: string } | undefined {
	if (body?.model) return body.model

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
 * Dispatcher entry point for running a session turn.
 *
 * Decides between the existing AI SDK loop (`runLoop`) and the Claude Code
 * CLI runtime (`runClaudeCodeLoop`) based on the resolved provider ID.
 *
 * Exists because the branch cannot live inside `promptSession` — `body.model`
 * is optional and the effective model may come from the previous user
 * message's metadata or the agent's default. All three sources have to be
 * consulted before we know which runtime to invoke.
 *
 * @param sessionId - The session to run the turn for
 * @param signal - AbortSignal for cancellation
 * @param body - Optional prompt body with model/agent overrides
 */
export async function runSession(
	sessionId: string,
	signal: AbortSignal,
	body?: PromptBody,
): Promise<void> {
	// Load messages once to resolve the effective model ref. `runLoop` will
	// re-load them anyway — that's fine and kept intentional so each runtime
	// owns its own view of history.
	const messages = queries.findMessagesBySessionId(sessionId) as any as MessageWithParts[]
	const modelRef = resolveModelRef(messages, body)

	if (modelRef?.providerId === CLAUDE_CODE_PROVIDER_ID) {
		log.info("Routing to Claude Code CLI runtime", {
			sessionId,
			modelId: modelRef.modelId,
		})
		// Provider switch from Cursor → Claude Code: drop any stale Cursor
		// agent so the next Cursor turn rebuilds cleanly.
		const cursorState = readCursorResumeState(sessionId)
		if (cursorState.cursorAgentId) {
			log.info("Clearing stale Cursor cursor on provider switch", {
				sessionId,
				toProvider: CLAUDE_CODE_PROVIDER_ID,
			})
			clearCursorResume(sessionId)
		}
		// Drop stale OpenCode cursor too — keep all three runtime cursors
		// independent so a future switch back starts fresh.
		clearOpenCodeResume(sessionId)
		await runClaudeCodeLoop(sessionId, signal, body)
		return
	}

	if (modelRef?.providerId === CURSOR_PROVIDER_ID) {
		log.info("Routing to Cursor SDK runtime", {
			sessionId,
			modelId: modelRef.modelId,
		})
		// Provider switch from Claude Code → Cursor: drop the Claude Code
		// resume cursor so a later switch back starts a fresh CLI session.
		const ccState = readResumeState(sessionId)
		if (ccState.claudeCodeSessionId) {
			log.info("Clearing stale Claude Code cursor on provider switch", {
				sessionId,
				toProvider: CURSOR_PROVIDER_ID,
			})
			clearResumeCursor(sessionId)
		}
		// Switching INTO Cursor also drops the OpenCode cursor.
		clearOpenCodeResume(sessionId)
		await runCursorLoop(sessionId, signal, body)
		return
	}

	if (modelRef?.providerId === OPENCODE_PROVIDER_ID) {
		log.info("Routing to OpenCode runtime", {
			sessionId,
			modelId: modelRef.modelId,
		})
		// Switching INTO OpenCode drops both Claude Code + Cursor cursors so
		// a future switch back starts those runtimes fresh.
		const ccState = readResumeState(sessionId)
		if (ccState.claudeCodeSessionId) {
			log.info("Clearing stale Claude Code cursor on provider switch", {
				sessionId,
				toProvider: OPENCODE_PROVIDER_ID,
			})
			clearResumeCursor(sessionId)
		}
		const cursorState = readCursorResumeState(sessionId)
		if (cursorState.cursorAgentId) {
			log.info("Clearing stale Cursor cursor on provider switch", {
				sessionId,
				toProvider: OPENCODE_PROVIDER_ID,
			})
			clearCursorResume(sessionId)
		}
		await runOpenCodeLoop(sessionId, signal, body)
		return
	}

	// Mid-session provider switch into the generic AI SDK loop: clear both
	// specialised runtime cursors so a later switch back starts fresh.
	const resumeState = readResumeState(sessionId)
	if (resumeState.claudeCodeSessionId) {
		log.info("Clearing stale Claude Code cursor on provider switch", {
			sessionId,
			toProvider: modelRef?.providerId,
		})
		clearResumeCursor(sessionId)
	}
	const cursorResume = readCursorResumeState(sessionId)
	if (cursorResume.cursorAgentId) {
		log.info("Clearing stale Cursor cursor on provider switch", {
			sessionId,
			toProvider: modelRef?.providerId,
		})
		clearCursorResume(sessionId)
	}
	// Drop any stale OpenCode cursor when leaving for the generic AI-SDK
	// loop — keeps the symmetry with the Claude Code / Cursor branches.
	clearOpenCodeResume(sessionId)

	await runLoop(sessionId, signal, body)
}
