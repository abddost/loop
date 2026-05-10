import { ulid } from "@core/id"
import * as Database from "../db"
import * as queries from "../db/queries"
import { bus } from "../workspace/bus"
import { runSession } from "./dispatch"
import { enrichSubmissionFiles } from "./enrich-files"
import type { PromptBody } from "./index"
import { sessionStates, setSessionStatus } from "./status"
import { createUserMessage } from "./user-message"

/**
 * Marker set on errors whose source runtime has already emitted a
 * session:error bus event with rich context. The fallback emission in
 * the catch block below skips errors carrying this marker so we don't
 * overwrite a detailed banner with a less informative one.
 */
const SESSION_ERROR_EMITTED = Symbol.for("loop.session-error-emitted")

/** Tag an error so the prompt.ts fallback skips re-emitting session:error. */
export function markSessionErrorEmitted(err: unknown): void {
	if (err && typeof err === "object") {
		;(err as Record<symbol, unknown>)[SESSION_ERROR_EMITTED] = true
	}
}

function isSessionErrorAlreadyEmitted(err: unknown): boolean {
	return !!(
		err &&
		typeof err === "object" &&
		(err as Record<symbol, unknown>)[SESSION_ERROR_EMITTED]
	)
}

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
		// Resolve path-only attachments (drag-from-file-tree) into self-
		// contained FileParts BEFORE persisting the user message. The
		// renderer can't read disk content from the browser context, so
		// it sends `mimeType: "application/x-loop-path"` with empty
		// `content`; we read the file here so every runtime sees the
		// same resolved bytes (Claude Code, Cursor, OpenCode, AI-SDK).
		body.files = await enrichSubmissionFiles(body.files)

		// Create user message first
		await createUserMessage(sessionId, body)

		// Dispatch to the correct runtime (AI SDK loop or Claude Code CLI)
		await runSession(sessionId, abort.signal, body)

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

		// Surface a session-level error banner in the UI. Skip if the
		// runtime already emitted a richer session:error (with details/source)
		// — the marker is set in claude-code/runtime.ts before re-throwing,
		// so the AI SDK loop is the only path that lands here unmarked.
		if (!isSessionErrorAlreadyEmitted(err)) {
			bus().emit("session:error", {
				sessionId,
				error: {
					severity: "error",
					source: "runtime",
					message: errorMessage,
					details: err instanceof Error ? err.stack : undefined,
					recoverable: true,
				},
			})
		}

		const callbacks = states[sessionId]?.callbacks ?? []
		setSessionStatus(sessionId, "idle")
		delete states[sessionId]
		for (const cb of callbacks) cb.reject(err as Error)
		throw err
	}
}
