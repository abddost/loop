import { toModelMessages } from "@core/message/convert"
import type { MessageWithParts } from "@core/schema/message"
import { AgentRegistry } from "../agent"
import * as queries from "../db/queries"
import type { MessageWithParts as DBMessageWithParts } from "../db/queries"
import { createLogger } from "../logger"
import { ProviderRegistry, streamWithRetry } from "../provider"
import { bus } from "../workspace/bus"

const log = createLogger("title")

/**
 * Generate a session title from the first user + assistant messages.
 * Fire-and-forget — errors are logged but do not propagate.
 */
export async function generateTitle(params: {
	sessionId: string
	userMessage: DBMessageWithParts
	assistantMessage: DBMessageWithParts
	modelRef: { modelId: string; providerId: string }
}): Promise<void> {
	const { sessionId, userMessage, assistantMessage, modelRef } = params

	const titleAgent = AgentRegistry.get("title")
	if (!titleAgent) {
		log.warn("Title agent not found")
		return
	}

	const resolved = ProviderRegistry.resolveModel(modelRef.providerId, modelRef.modelId)

	const contextMessages = [userMessage, assistantMessage] as unknown as MessageWithParts[]
	const coreMessages = toModelMessages(contextMessages)

	const abort = new AbortController()
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

	let title = ""
	for await (const chunk of stream.fullStream) {
		if (chunk.type === "text-delta") {
			title += chunk.text
		}
	}

	title = title.trim()
	if (!title) return

	// Truncate to 50 characters
	if (title.length > 50) {
		title = title.slice(0, 50).trimEnd()
	}

	queries.updateSession(sessionId, { title })

	const updated = queries.findSessionById(sessionId)
	bus().emit("session:update", { sessionId, session: updated })
}
