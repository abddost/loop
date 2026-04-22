import { toModelMessages } from "@core/message/convert"
import type { MessageWithParts } from "@core/schema/message"
import { AgentRegistry } from "../agent"
import * as queries from "../db/queries"
import type { MessageWithParts as DBMessageWithParts } from "../db/queries"
import { createLogger } from "../logger"
import { ProviderRegistry, ProviderTransform, streamWithRetry } from "../provider"
import { bus } from "../workspace/bus"

const log = createLogger("title")

const MODEL_TITLE_TIMEOUT_MS = 15_000

/**
 * Ensure a session has a title. Fire-and-forget — safe to call multiple times
 * (guards on `!session.title`). Callers should discard the returned promise
 * and attach their own `.catch()` for logging.
 *
 * Runtimes:
 *   - Main AI-SDK loop / Cursor: pass `modelRef` so the high-quality model
 *     path runs first; if it errors, we fall back to deterministic derivation.
 *   - Claude Code: omit `modelRef`. The synthetic `claude-code` provider
 *     isn't registered in ProviderRegistry, so a model call would throw.
 *     Goes straight to derivation — free, fast, no extra tokens.
 */
export async function ensureSessionTitle(params: {
	sessionId: string
	modelRef?: { modelId: string; providerId: string }
}): Promise<void> {
	const { sessionId, modelRef } = params

	const session = queries.findSessionById(sessionId)
	if (!session || session.title) return

	const msgs = queries.findMessagesBySessionId(sessionId)
	const firstUser = msgs.find((m) => m.role === "user" && !isSyntheticUserMessage(m))
	if (!firstUser) return

	// Path A: model-based title
	if (modelRef) {
		const firstAssistant = msgs.find((m) => m.role === "assistant")
		if (firstAssistant) {
			try {
				const title = await runModelTitle({
					userMessage: firstUser,
					assistantMessage: firstAssistant,
					modelRef,
				})
				if (title) {
					applyTitle(sessionId, title)
					return
				}
				log.warn("Title model returned empty text — falling back to derivation", {
					sessionId,
					providerId: modelRef.providerId,
					modelId: modelRef.modelId,
				})
			} catch (err) {
				log.error("Title model call failed — falling back to derivation", {
					sessionId,
					providerId: modelRef.providerId,
					modelId: modelRef.modelId,
					error: err instanceof Error ? err.message : String(err),
				})
			}
		}
	}

	// Path B: deterministic derivation
	const derived = deriveTitleFromUserMessage(firstUser)
	if (!derived) return

	// Last-writer-wins re-check: a concurrent caller (e.g. step-1 fire-and-forget
	// racing with the post-loop tail) may have already landed a title.
	const latest = queries.findSessionById(sessionId)
	if (!latest || latest.title) return

	applyTitle(sessionId, derived)
}

/**
 * Stream a title from the configured title agent. Returns the trimmed,
 * truncated string — or undefined if the model produced no text. Errors
 * propagate so the caller can fall back.
 */
async function runModelTitle(params: {
	userMessage: DBMessageWithParts
	assistantMessage: DBMessageWithParts
	modelRef: { modelId: string; providerId: string }
}): Promise<string | undefined> {
	const { userMessage, assistantMessage, modelRef } = params

	const titleAgent = AgentRegistry.get("title")
	if (!titleAgent) throw new Error("Title agent not registered")

	const resolved = await ProviderRegistry.resolveModel(modelRef.providerId, modelRef.modelId)

	const contextMessages = [userMessage, assistantMessage] as unknown as MessageWithParts[]
	const coreMessages = ProviderTransform.messages(
		toModelMessages(contextMessages),
		resolved.info,
		resolved.npm,
	)

	const abort = new AbortController()
	const timer = setTimeout(() => abort.abort(), MODEL_TITLE_TIMEOUT_MS)

	let title = ""
	try {
		const stream = await streamWithRetry(
			{
				model: resolved.instance,
				system: titleAgent.prompt ?? "Generate a short title for this conversation.",
				messages: coreMessages,
				temperature: titleAgent.temperature ?? 0.5,
				maxOutputTokens: 80,
			},
			abort.signal,
		)

		for await (const chunk of stream.fullStream) {
			if (chunk.type === "text-delta") {
				title += chunk.text
			}
		}
	} finally {
		clearTimeout(timer)
	}

	title = title.trim()
	if (!title) return undefined

	if (title.length > 50) {
		title = title.slice(0, 50).trimEnd()
	}
	return title || undefined
}

function applyTitle(sessionId: string, title: string): void {
	queries.updateSession(sessionId, { title })
	const updated = queries.findSessionById(sessionId)
	bus().emit("session:update", { sessionId, session: updated })
}

/**
 * Extract a short, human-readable title from a user message's text parts.
 * Strips whitespace, collapses newlines, and caps at 50 chars on a word
 * boundary. Returns undefined if no text is available.
 */
export function deriveTitleFromUserMessage(msg: {
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
export function isSyntheticUserMessage(msg: {
	parts?: Array<{ type?: string; synthetic?: boolean }>
}): boolean {
	const parts = msg.parts ?? []
	if (parts.length === 0) return false
	return parts.every((p) => p.type === "text" && p.synthetic === true)
}
