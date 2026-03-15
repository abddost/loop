import { ulid } from "@core/id"
import * as Database from "../db"
import * as queries from "../db/queries"
import { bus } from "../workspace/bus"
import type { PromptBody } from "./index"

/**
 * Create a user message from prompt body.
 * A UserMessage is a self-contained turn descriptor — it records which agent,
 * model, system prompt, and tool permissions were active when the user sent it.
 *
 * @param sessionId - The session to add the message to
 * @param body - The prompt body containing text, files, and metadata
 * @returns The ID of the created message
 */
export async function createUserMessage(sessionId: string, body: PromptBody): Promise<string> {
	const messageId = ulid()

	// Build metadata snapshot
	const metadata = {
		agent: body.agent ?? "build",
		model: body.model,
		option: body.option,
		tools: body.tools,
	}

	Database.withEffects((_tx, effect) => {
		// Insert message
		queries.createMessage({
			id: messageId,
			sessionId,
			role: "user",
			metadata,
		})

		// Build parts for both DB insertion and SSE event
		const parts: Array<{ id: string; type: string; [key: string]: unknown }> = []

		// Insert text part
		if (body.text) {
			const textPartId = ulid()
			const data = {
				type: "text" as const,
				text: body.text,
				synthetic: body.synthetic,
			}
			queries.upsertPart({
				id: textPartId,
				sessionId,
				messageId,
				type: "text",
				data,
			})
			parts.push({ id: textPartId, ...data })
		}

		// Insert file parts
		if (body.files) {
			for (const file of body.files) {
				const filePartId = ulid()
				const data = {
					type: "file" as const,
					path: file.path,
					mimeType: file.mimeType,
					content: file.content,
				}
				queries.upsertPart({
					id: filePartId,
					sessionId,
					messageId,
					type: "file",
					data,
				})
				parts.push({ id: filePartId, ...data })
			}
		}

		effect(() => {
			const fullMessage = {
				id: messageId,
				sessionId,
				role: "user" as const,
				metadata,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				parts,
			}
			bus().emit("message:create", { sessionId, message: fullMessage })
		})
	})

	return messageId
}
