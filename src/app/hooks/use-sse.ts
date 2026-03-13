import { useEffect } from "react"
import { sseClient } from "../lib/sse-client"
import { workspaceStoreRegistry } from "../stores/workspace-store"

/**
 * Hook that routes SSE events to the correct workspace store.
 * Should be mounted once at the app root.
 */
export function useSSERouter() {
	useEffect(() => {
		sseClient.onEvents((events) => {
			for (const event of events) {
				if (event.type === "heartbeat") continue

				const directory = "directory" in event ? event.directory : undefined
				if (!directory) continue

				const store = workspaceStoreRegistry.get(directory)
				if (!store) continue

				const state = store.getState()

				switch (event.type) {
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
					case "part:upsert":
						state.upsertPart(event.sessionId, event.messageId, event.part)
						break
					case "part:delta":
						state.appendDelta(event.sessionId, event.messageId, event.partId, event.delta)
						break
					case "permission:request":
						state.addPermissionRequest(event.sessionId, event.request as any)
						break
					case "question:request":
						state.addQuestion(event.sessionId, event.question as any)
						break
				}
			}
		})

		return () => sseClient.dispose()
	}, [])
}
