import { ulid } from "@core/id"
import type { MessageWithParts } from "@core/schema/message"
import * as Database from "../db"
import * as queries from "../db/queries"
import { createLogger } from "../logger"
import { bus } from "../workspace/bus"

const log = createLogger("compaction")

/**
 * Check if compaction is needed based on token usage vs context window.
 * Returns true when total tokens approach the context limit minus a safety buffer.
 *
 * @param totalTokens - Current total token count
 * @param contextWindow - Model's context window size
 * @param buffer - Safety buffer to keep free (default 8000)
 */
export function needsCompaction(
	totalTokens: number,
	contextWindow: number,
	buffer = 8000,
): boolean {
	return totalTokens > contextWindow - buffer
}

/**
 * Run compaction: summarize conversation history and create boundary markers.
 *
 * 1. Send full history to compaction agent for summarization
 * 2. Insert AssistantMessage(summary: true) with summary text
 * 3. Insert UserMessage with CompactionPart(auto: true) — boundary marker
 * 4. Insert UserMessage with synthetic TextPart: "Continue if you have next steps..."
 *
 * @param params.sessionId - The session being compacted
 * @param params.messages - Current conversation messages
 * @param params.summary - The compaction summary text (from compaction agent)
 * @param params.signal - AbortSignal for cancellation
 */
export async function runCompaction(params: {
	sessionId: string
	messages: MessageWithParts[]
	summary: string
	signal: AbortSignal
}): Promise<void> {
	const { sessionId, summary, signal } = params

	if (signal.aborted) return

	const now = Date.now()

	Database.withEffects((_tx, effect) => {
		// 1. Insert AssistantMessage with summary text
		const summaryMessageId = ulid()
		queries.createMessage({
			id: summaryMessageId,
			sessionId,
			role: "assistant",
			metadata: { summary: true, finish: "stop" },
		})

		queries.upsertPart({
			id: ulid(),
			sessionId,
			messageId: summaryMessageId,
			type: "text",
			data: { type: "text", text: summary, synthetic: true },
		})

		// 2. Insert UserMessage with CompactionPart boundary marker
		const boundaryMessageId = ulid()
		queries.createMessage({
			id: boundaryMessageId,
			sessionId,
			role: "user",
			metadata: {},
		})

		queries.upsertPart({
			id: ulid(),
			sessionId,
			messageId: boundaryMessageId,
			type: "compaction",
			data: { type: "compaction", auto: true },
		})

		// 3. Insert synthetic continuation prompt
		const continueMessageId = ulid()
		queries.createMessage({
			id: continueMessageId,
			sessionId,
			role: "user",
			metadata: {},
		})

		queries.upsertPart({
			id: ulid(),
			sessionId,
			messageId: continueMessageId,
			type: "text",
			data: {
				type: "text",
				text: "Continue if you have next steps. Otherwise, let me know you're done.",
				synthetic: true,
			},
		})

		// Update session compactedAt timestamp
		queries.updateSession(sessionId, { compactedAt: now })

		effect(() => {
			bus().emit("session:update", {
				sessionId,
				session: queries.findSessionById(sessionId),
			})
		})
	})

	log.info("Compaction completed", { sessionId })
}
