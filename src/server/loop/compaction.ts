import { ulid } from "@core/id"
import type { MessageWithParts } from "@core/schema/message"
import type { Part } from "@core/schema/part"
import { eq } from "drizzle-orm"
import * as Database from "../db"
import { get } from "../db"
import * as queries from "../db/queries"
import { partTable } from "../db/tables/part"
import { createLogger } from "../logger"
import { bus } from "../workspace/bus"

const log = createLogger("compaction")

// ─── Constants ───────────────────────────────────────────────────

export const COMPACTION_BUFFER = 20_000
const PRUNE_MINIMUM = 20_000 // minimum tokens worth of pruning to justify the operation
const PRUNE_PROTECT = 40_000 // protect last 40k tokens of tool calls
export const CHARS_PER_TOKEN = 4 // rough estimate for token-to-char conversion

/** Max consecutive compaction attempts before the loop gives up. Prevents
 *  runaway compaction loops when summaries are too large or token reporting
 *  is inaccurate. */
export const COMPACTION_RETRY_LIMIT = 3

// ─── Compaction summary template ─────────────────────────────────

export const COMPACTION_USER_PROMPT = `Provide a detailed prompt for continuing our conversation above.
Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next.
The summary that you construct will be used so that another agent can read it and continue the work.

When constructing the summary, try to stick to this template:
---
## Goal
[What goal(s) is the user trying to accomplish?]

## Instructions
- [What important instructions did the user give you that are relevant]
- [If there is a plan or spec, include information about it so next agent can continue using it]

## Discoveries
[What notable things were learned during this conversation that would be useful for the next agent to know when continuing the work]

## Accomplished
[What work has been completed, what work is still in progress, and what work is left?]

## Relevant files / directories
[Construct a structured list of relevant files that have been read, edited, or created that pertain to the task at hand. If all the files in a directory are relevant, include the path to the directory.]
---`

// ─── needsCompaction ─────────────────────────────────────────────

/**
 * Check if compaction is needed based on token usage vs context window.
 *
 * `totalTokens` should be the **last API step's** input + output + reasoning,
 * NOT a running sum across steps (each step's inputTokens already includes
 * all prior context). This value approximates the next call's prompt size.
 *
 * Threshold: usable = contextWindow - min(COMPACTION_BUFFER, maxOutput)
 * The buffer reserves headroom for the model's next response.
 *
 * @param totalTokens - Last step's input + output + reasoning tokens
 * @param contextWindow - Model's context window size
 * @param maxOutput - Model's maximum output token limit (defaults to COMPACTION_BUFFER)
 */
export function needsCompaction(
	totalTokens: number,
	contextWindow: number,
	maxOutput: number = COMPACTION_BUFFER,
): boolean {
	if (contextWindow === 0) return false
	const reserved = Math.min(COMPACTION_BUFFER, maxOutput)
	const usable = contextWindow - reserved
	return totalTokens >= usable
}

// ─── Cooldown guard ─────────────────────────────────────────────

/**
 * Check whether a real (non-summary) assistant turn exists after the last
 * compaction boundary in the message array. Returns false if the most recent
 * messages are only the compaction artifacts (summary + boundary + continuation)
 * with no actual model work yet.
 */
export function hasModelTurnSinceCompaction(messages: MessageWithParts[]): boolean {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]

		if (msg.role === "user" && msg.parts.some((p) => p.type === "compaction")) {
			return false
		}

		if (msg.role === "assistant") {
			const meta = msg.metadata as { summary?: boolean } | undefined
			if (!meta?.summary) return true
		}
	}
	return true
}

// ─── runCompaction ───────────────────────────────────────────────

/**
 * Run compaction: insert summary boundary and continuation prompt.
 *
 * 1. Insert AssistantMessage(summary: true) with summary text
 * 2. Insert UserMessage with CompactionPart(auto: true) — boundary marker
 * 3. Insert either:
 *    - overflow=true: replay the last non-compaction user message
 *    - overflow=false: synthetic "Continue if you have next steps..." prompt
 *
 * @returns success=true if boundary was created, false if something went wrong
 */
export async function runCompaction(params: {
	sessionId: string
	messages: MessageWithParts[]
	summary: string
	signal: AbortSignal
	overflow?: boolean
}): Promise<{ success: boolean; error?: string }> {
	const { sessionId, summary, signal, messages, overflow } = params

	if (signal.aborted) return { success: false, error: "aborted" }

	if (!summary.trim()) {
		log.error("Compaction produced empty summary, skipping boundary", { sessionId })
		return { success: false, error: "empty summary" }
	}

	const now = Date.now()

	// Find the last non-compaction user message for overflow replay
	const replayMessage = overflow ? findReplayMessage(messages) : undefined

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

		// 3. Insert continuation message
		const continueMessageId = ulid()
		queries.createMessage({
			id: continueMessageId,
			sessionId,
			role: "user",
			metadata: {},
		})

		if (replayMessage) {
			// Overflow replay: re-insert the user's parts as text
			for (const part of replayMessage.parts) {
				queries.upsertPart({
					id: ulid(),
					sessionId,
					messageId: continueMessageId,
					type: "text",
					data: replayPartAsText(part),
				})
			}
		} else {
			// Standard continuation prompt
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
		}

		// Update session compactedAt timestamp
		queries.updateSession(sessionId, { compactedAt: now })

		effect(() => {
			bus().emit("session:update", {
				sessionId,
				session: queries.findSessionById(sessionId),
			})
		})
	})

	log.info("Compaction completed", { sessionId, overflow: !!overflow })
	return { success: true }
}

// ─── Overflow replay helpers ─────────────────────────────────────

/**
 * Find the most recent user message that isn't a compaction boundary.
 * Only returns a message if there are meaningful messages before the replay point.
 */
function findReplayMessage(messages: MessageWithParts[]): MessageWithParts | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.role !== "user") continue

		const isCompaction = msg.parts.some((p) => p.type === "compaction")
		if (isCompaction) continue

		// Safety check: don't replay if there's nothing meaningful before this point
		const hasPriorContent = i > 0
		if (!hasPriorContent) return undefined

		return msg
	}
	return undefined
}

/**
 * Convert a user part into a text-only representation for overflow replay.
 * Text parts pass through; file/image parts become placeholders.
 */
function replayPartAsText(part: Part): { type: "text"; text: string; synthetic: true } {
	switch (part.type) {
		case "text":
			return { type: "text", text: part.text, synthetic: true }
		case "file":
			return {
				type: "text",
				text: `[Attached ${part.mimeType}: ${part.path}]`,
				synthetic: true,
			}
		default:
			return { type: "text", text: "", synthetic: true }
	}
}

// ─── Token estimation helpers ────────────────────────────────────

/**
 * Estimate total token count for a message array using character-based
 * approximation. Used to check if messages fit within a context window
 * before sending them to the compaction agent.
 */
export function estimateMessageTokens(messages: MessageWithParts[]): number {
	let total = 0
	for (const msg of messages) {
		for (const part of msg.parts) {
			if (part.type === "text") {
				total += Math.ceil(part.text.length / CHARS_PER_TOKEN)
			} else if (part.type === "tool") {
				total += Math.ceil((part.output ?? "").length / CHARS_PER_TOKEN)
				total += Math.ceil(JSON.stringify(part.input ?? {}).length / CHARS_PER_TOKEN)
			}
		}
	}
	return total
}

/**
 * Truncate messages to fit within a target token budget.
 * Drops oldest messages first, preserving at least the last 2.
 * Used as a safety net when the compaction agent's context would overflow
 * even after pruning tool outputs.
 */
export function truncateForCompaction(
	messages: MessageWithParts[],
	targetTokens: number,
): MessageWithParts[] {
	if (estimateMessageTokens(messages) <= targetTokens) return messages

	const minKeep = Math.min(2, messages.length)
	for (let start = messages.length - minKeep; start > 0; start--) {
		const slice = messages.slice(start)
		if (estimateMessageTokens(slice) <= targetTokens) {
			return slice
		}
	}

	return messages.slice(-minKeep)
}

// ─── pruneToolOutputs ────────────────────────────────────────────

/**
 * Prune old tool outputs to reduce stored context size.
 * Runs after the main loop exits. Replaces tool output with a placeholder
 * for completed tools beyond the protection threshold.
 *
 * Rules:
 * - Skip the last 2 user turns (always protect recent context)
 * - Stop at any compaction boundary (summary message)
 * - Only prune completed tool calls beyond PRUNE_PROTECT threshold
 * - Only execute if total prunable content exceeds PRUNE_MINIMUM tokens
 */
export async function pruneToolOutputs(sessionId: string): Promise<void> {
	const messages = queries.findMessagesBySessionId(sessionId) as MessageWithParts[]
	if (messages.length === 0) return

	// Find the boundary: stop at the last compaction boundary
	let stopIndex = 0
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.role === "user" && msg.parts.some((p) => p.type === "compaction")) {
			stopIndex = i + 1
			break
		}
	}

	// Count the last 2 user turns from the end — these are always protected
	let userTurnCount = 0
	let protectFromIndex = messages.length
	for (let i = messages.length - 1; i >= stopIndex; i--) {
		if (messages[i].role === "user") {
			userTurnCount++
			if (userTurnCount >= 2) {
				protectFromIndex = i
				break
			}
		}
	}

	// Walk backward from the protect boundary, collecting prunable tool parts
	// Track cumulative token estimate to apply PRUNE_PROTECT threshold
	let tokensSeen = 0
	const toPrune: Array<{ partId: string; messageId: string; output: string; data: Part }> = []

	for (let i = protectFromIndex - 1; i >= stopIndex; i--) {
		const msg = messages[i]
		if (msg.role !== "assistant") continue

		for (let j = msg.parts.length - 1; j >= 0; j--) {
			const part = msg.parts[j]
			if (part.type !== "tool") continue
			if (part.state !== "completed") continue

			const output = part.output ?? ""
			const outputTokens = Math.ceil(output.length / CHARS_PER_TOKEN)
			tokensSeen += outputTokens

			// Only prune beyond the protection threshold
			if (tokensSeen <= PRUNE_PROTECT) continue

			// Only prune if there's meaningful content
			if (output.length === 0) continue

			// Skip already-pruned parts
			if (part.time?.compacted) continue

			toPrune.push({
				partId: (part as any).id,
				messageId: msg.id,
				output,
				data: part,
			})
		}
	}

	// Check if total prunable content justifies the operation
	const totalPrunableTokens = toPrune.reduce(
		(sum, p) => sum + Math.ceil(p.output.length / CHARS_PER_TOKEN),
		0,
	)
	if (totalPrunableTokens < PRUNE_MINIMUM) {
		log.debug("Pruning skipped — below minimum threshold", {
			sessionId,
			prunableTokens: totalPrunableTokens,
			threshold: PRUNE_MINIMUM,
		})
		return
	}

	// Execute pruning in a single transaction
	const now = Date.now()
	const db = get()
	db.transaction(() => {
		for (const entry of toPrune) {
			const charCount = entry.output.length
			const prunedData = {
				...entry.data,
				output: `[Output pruned — ${charCount} chars]`,
				time: {
					...(entry.data.type === "tool" ? entry.data.time : undefined),
					compacted: true,
					prunedAt: now,
				},
			}

			// Remove the merged `id` field from the part data before persisting.
			// `findMessagesBySessionId` merges the row id into the part object,
			// but the `data` column should not contain it.
			const { id: _id, ...cleanData } = prunedData as Record<string, unknown>

			db.update(partTable)
				.set({ data: cleanData, updatedAt: now })
				.where(eq(partTable.id, entry.partId))
				.run()
		}
	})

	log.info("Tool outputs pruned", {
		sessionId,
		prunedCount: toPrune.length,
		prunedTokens: totalPrunableTokens,
	})
}
