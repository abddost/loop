import type { MessageWithParts } from "../schema/message"

/**
 * Walks a message array backwards to find the last completed compaction boundary
 * and returns only messages from that boundary forward.
 *
 * Algorithm:
 * 1. Walk backwards through messages
 * 2. Find an AssistantMessage with metadata.summary === true AND metadata.finish set
 * 3. Record its preceding UserMessage.id in a `completed` set
 * 4. Continue backwards — when hitting a UserMessage with a CompactionPart whose
 *    id is in `completed`, break and return messages from that point forward
 * 5. If no compaction found, return all messages
 *
 * @param messages - The full message array to filter
 * @returns Messages from the last completed compaction boundary forward
 */
export function filterCompacted(messages: MessageWithParts[]): MessageWithParts[] {
	if (messages.length === 0) return messages

	const completed = new Set<string>()
	let breakIndex = 0

	// Walk backwards to find compaction boundaries
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]

		if (msg.role === "assistant") {
			const meta = msg.metadata as { summary?: boolean; finish?: string } | undefined
			if (meta?.summary === true && meta.finish) {
				// Look for the preceding user message
				if (i > 0 && messages[i - 1].role === "user") {
					completed.add(messages[i - 1].id)
				}
			}
			continue
		}

		if (msg.role === "user" && completed.has(msg.id)) {
			const hasCompactionPart = msg.parts.some((p) => p.type === "compaction")
			if (hasCompactionPart) {
				breakIndex = i
				break
			}
		}
	}

	return messages.slice(breakIndex)
}
