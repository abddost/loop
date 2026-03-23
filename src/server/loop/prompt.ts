import { ulid } from "@core/id"
import * as Database from "../db"
import * as queries from "../db/queries"
import { bus } from "../workspace/bus"
import type { PromptBody } from "./index"
import { runLoop } from "./index"
import { sessionStates, setSessionStatus } from "./status"
import { createUserMessage } from "./user-message"

/**
 * Handle a prompt request for a session.
 * First caller becomes the active runner; subsequent callers attach callbacks.
 * When the session finishes, all callbacks fire.
 *
 * @param sessionId - The session to prompt
 * @param body - The prompt body containing text, files, model, etc.
 */
export async function promptSession(sessionId: string, body: PromptBody): Promise<void> {
	const states = sessionStates()
	const existing = states[sessionId]

	if (existing && existing.status !== "idle") {
		// Fan-out: attach to existing run
		return new Promise<void>((resolve, reject) => {
			existing.callbacks.push({ resolve, reject })
		})
	}

	// Create abort controller and state
	const abort = new AbortController()
	states[sessionId] = { abort, status: "busy", callbacks: [] }

	setSessionStatus(sessionId, "busy")

	try {
		// Create user message first
		await createUserMessage(sessionId, body)

		// Run the agentic loop
		await runLoop(sessionId, abort.signal, body)

		// Success: resolve all callbacks
		const callbacks = states[sessionId]?.callbacks ?? []
		setSessionStatus(sessionId, "idle")
		delete states[sessionId]
		for (const cb of callbacks) cb.resolve()
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err)

		// Persist error as an assistant message so the user can see what went wrong
		const errorMessageId = ulid()
		const errorPartId = ulid()
		Database.withEffects((_tx, effect) => {
			queries.createMessage({
				id: errorMessageId,
				sessionId,
				role: "assistant",
				metadata: { error: true },
			})
			queries.upsertPart({
				id: errorPartId,
				sessionId,
				messageId: errorMessageId,
				type: "text",
				data: { type: "text", text: `Error: ${errorMessage}` },
			})

			effect(() => {
				bus().emit("message:create", {
					sessionId,
					message: {
						id: errorMessageId,
						sessionId,
						role: "assistant",
						metadata: { error: true },
						createdAt: Date.now(),
						updatedAt: Date.now(),
						parts: [{ id: errorPartId, type: "text", text: `Error: ${errorMessage}` }],
					},
				})
			})
		})

		const callbacks = states[sessionId]?.callbacks ?? []
		setSessionStatus(sessionId, "idle")
		delete states[sessionId]
		for (const cb of callbacks) cb.reject(err as Error)
		throw err
	}
}
