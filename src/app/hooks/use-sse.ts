import { useEffect } from "react"
import { sseClient } from "../lib/sse-client"
import { streamingBuffer } from "../lib/streaming-buffer"
import { workspaceStoreRegistry } from "../stores/workspace-store"

/**
 * Hook that routes SSE events to the correct workspace store.
 * Must be mounted exactly once at the app root.
 *
 * Event routing:
 *   - part:delta → streaming buffer (mutable, no Zustand update per token)
 *   - part:upsert → Zustand store + streaming buffer commit
 *   - other events → Zustand store directly
 *
 * The streaming buffer avoids the cost of immer/Zustand state updates on
 * every token (50-100+/s). Instead, components read streaming text via
 * `useStreamingText` hook backed by `useSyncExternalStore`.
 *
 * On SSE reconnection, the streaming buffer is cleared and the app can
 * refetch stale state. No server-side event replay is needed — the REST
 * endpoints are the source of truth.
 */
export function useSSERouter() {
	useEffect(() => {
		sseClient.onEvents((events) => {
			let hasDelta = false

			for (const event of events) {
				// Heartbeat and server.connected are handled by the SSE client
				if (event.type === "heartbeat" || event.type === "server.connected") continue

				const directory = "directory" in event ? event.directory : undefined
				if (!directory) continue

				const store = workspaceStoreRegistry.get(directory)
				if (!store) continue

				const state = store.getState()

				switch (event.type) {
					case "part:delta": {
						// Route deltas to the streaming buffer instead of Zustand.
						// This avoids immer overhead (full state copy) on every token.
						const isNew = streamingBuffer.append(event.partId, event.delta)
						if (isNew) {
							// First delta for this part — create a one-time placeholder
							// in Zustand so the component tree knows a new part exists.
							state.createStreamingPart(event.sessionId, event.messageId, event.partId)
						}
						hasDelta = true
						break
					}

					case "part:upsert": {
						// Final part data from server (after DB commit).
						// Update Zustand FIRST (so component has fallback text),
						// then commit the streaming buffer entry.
						state.upsertPart(event.sessionId, event.messageId, event.part)
						const partId = (event.part as Record<string, unknown>).id as string | undefined
						if (partId) {
							streamingBuffer.commit(partId)
						}
						break
					}

					case "session:status":
						state.setSessionStatus(event.sessionId, event.status)
						break

					case "session:update":
						if (event.session) {
							state.updateSession(event.sessionId, event.session as any)
						}
						break

					case "message:create":
						state.addMessage(event.sessionId, event.message as any)
						break

					case "permission:request":
						state.addPermissionRequest(event.sessionId, event.request as any)
						break

					case "question:request":
						state.addQuestion(event.sessionId, event.question as any)
						break
				}
			}

			// Notify streaming buffer subscribers once for the entire batch.
			// This triggers a single useSyncExternalStore re-render for all
			// components reading streaming text, regardless of how many deltas
			// arrived in this frame.
			if (hasDelta) {
				streamingBuffer.flush()
			}
		})

		// On reconnection: clear streaming buffer (any in-flight text may be stale)
		// and let the app refetch current state from REST endpoints.
		// No server-side event replay needed.
		sseClient.onReconnect(() => {
			streamingBuffer.clear()
		})

		return () => sseClient.dispose()
	}, [])
}
