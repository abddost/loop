import type { MessageWithParts } from "@core/schema/message"
import { AgentRegistry } from "../agent"
import * as queries from "../db/queries"
import { createLogger } from "../logger"
import { CLAUDE_CODE_PROVIDER_ID } from "../provider/claude-code/models"
import { runClaudeCodeLoop } from "./claude-code/runtime"
import { clearResumeCursor, readResumeState } from "./claude-code/session"
import { type PromptBody, runLoop } from "./index"

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
		await runClaudeCodeLoop(sessionId, signal, body)
		return
	}

	// Mid-session provider switch: if the previous turn was Claude Code and
	// this turn is going to the AI SDK loop, clear the resume cursor so a
	// later switch back starts a fresh CLI session instead of resuming one
	// that no longer matches the local message history.
	const resumeState = readResumeState(sessionId)
	if (resumeState.claudeCodeSessionId) {
		log.info("Clearing stale Claude Code cursor on provider switch", {
			sessionId,
			toProvider: modelRef?.providerId,
		})
		clearResumeCursor(sessionId)
	}

	await runLoop(sessionId, signal, body)
}
