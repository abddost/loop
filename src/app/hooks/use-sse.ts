import type { SessionStatus } from "@core/schema/session"
import { useEffect } from "react"
import { refreshWorkspace } from "../bootstrap"
import { apiClient } from "../lib/api-client"
import { ensureSession } from "../lib/session-loader"
import { sseClient } from "../lib/sse-client"
import { streamingBuffer } from "../lib/streaming-buffer"
import { worktreeApi } from "../lib/worktree-api"
import { worktreeState } from "../lib/worktree-state"
import { useAgentStore } from "../stores/agent-store"
import { useFilePanelStore } from "../stores/file-panel-store"
import { useMcpStore } from "../stores/mcp-store"
import { useProjectStore } from "../stores/project-store"
import { useUIStore } from "../stores/ui-store"
import { workspaceStoreRegistry } from "../stores/workspace-store"
import { useWorktreeStore } from "../stores/worktree-store"

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
			// Batch git-status + branch refreshes across the event frame so bulk
			// file writes don't trigger one `/vcs/status` call per event.
			let needsGitStatus = false
			const branchRefreshDirs = new Set<string>()

			for (const event of events) {
				// Heartbeat and server.connected are handled by the SSE client
				if (event.type === "heartbeat" || event.type === "server.connected") continue

				// Project-level events (no directory field)
				if (event.type === "project:delete") {
					useProjectStore.getState().removeProject(event.projectId)
					continue
				}

				const directory = "directory" in event ? event.directory : undefined
				if (!directory) continue

				// Workspace-level events (no sessionId) — handle before session lookup
				if (event.type === "file:changed") {
					// File tree / open-file invalidation from the watcher or write tools.
					useFilePanelStore.getState().invalidateFromWatcher(event.path, event.event)
					// Git status also becomes stale (add/unlink affect untracked/modified lists).
					needsGitStatus = true
					continue
				}

				if (event.type === "git:changed") {
					needsGitStatus = true
					branchRefreshDirs.add(directory)
					continue
				}

				// Worktree lifecycle events
				if (event.type === "worktree:ready") {
					worktreeState.ready(event.worktreeDirectory)
					useWorktreeStore.getState().setWorktreeStatus(event.worktreeDirectory, "ready")
					useWorktreeStore.getState().setBusy(event.worktreeDirectory, false)
					continue
				}
				if (event.type === "worktree:failed") {
					worktreeState.failed(event.worktreeDirectory, event.error)
					useWorktreeStore
						.getState()
						.setWorktreeStatus(event.worktreeDirectory, "failed", event.error)
					useWorktreeStore.getState().setBusy(event.worktreeDirectory, false)
					continue
				}
				if (event.type === "worktree:removed") {
					useWorktreeStore.getState().removeWorktree(event.sandboxId)
					continue
				}
				if (event.type === "worktree:reset") {
					// Refresh VCS state for the reset worktree
					continue
				}

				// MCP status updates — refresh the full server list
				if (event.type === "mcp:status") {
					useMcpStore.getState().refresh()
					continue
				}

				const store = workspaceStoreRegistry.get(directory)
				if (!store) continue

				const state = store.getState()

				// Check if event belongs to the active session or a registered child session.
				// The active-session window is closed by `useSessionPage`'s effect, which
				// sets `activeSessionId` *before* awaiting `ensureSession` — so events
				// arriving during the loader's in-flight window still match here.
				const isKnownSession =
					"sessionId" in event &&
					(event.sessionId === state.activeSessionId ||
						state.messages.has(event.sessionId) ||
						state.childSessionIds.has(event.sessionId))

				switch (event.type) {
					case "part:delta": {
						// Only route deltas for known sessions (active, loaded, or child).
						if (!isKnownSession) break

						// Route deltas to the streaming buffer instead of Zustand.
						// This avoids immer overhead (full state copy) on every token.
						const isNew = streamingBuffer.append(event.partId, event.delta)
						if (isNew) {
							// First delta for this part — create a one-time placeholder
							// in Zustand so the component tree knows a new part exists.
							state.createStreamingPart(
								event.sessionId,
								event.messageId,
								event.partId,
								event.partType,
							)
						}
						hasDelta = true
						break
					}

					case "part:upsert": {
						// Route upserts for known sessions (active, loaded, or child).
						if (!isKnownSession) break

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

					case "session:update": {
						if (!event.session) break
						const sess = event.session as Record<string, unknown>
						if (sess.archivedAt) {
							// Archived: remove from sidebar
							state.removeSession(event.sessionId)
						} else {
							const exists = state.sessions.some((s) => s.id === event.sessionId)
							if (!exists && !sess.archivedAt) {
								// Unarchived: add back to sidebar
								state.addSession(sess as any)
							} else {
								state.updateSession(event.sessionId, sess as any)
							}
						}
						// Sync permission mode when the active session's mode changes
						// (e.g. after plan approval resets to "default" or "auto-accept-edits")
						if (
							typeof sess.permissionMode === "string" &&
							event.sessionId === state.activeSessionId
						) {
							state.setPermissionMode(sess.permissionMode)
						}
						break
					}

					case "session:usage":
						state.setSessionUsage(event.sessionId, {
							input: event.usage.input,
							output: event.usage.output,
							reasoning: event.usage.reasoning,
							cacheRead: event.usage.cacheRead,
							cacheWrite: event.usage.cacheWrite,
							cost: event.cost,
							contextWindow: event.contextWindow,
						})
						break

					case "message:create": {
						// Route messages for active session and child sessions.
						if (!isKnownSession) break

						const msg = event.message as any
						state.addMessage(event.sessionId, msg)
						// Detect agent switch from synthetic messages and update agent selector
						if (msg.metadata?.synthetic && msg.metadata?.agent) {
							useAgentStore.getState().setSelectedAgent(msg.metadata.agent)
						}
						break
					}

					case "permission:request":
						state.addPermissionRequest(event.sessionId, event.request as any)
						break

					case "question:request":
						state.addQuestion(event.sessionId, event.question as any)
						break

					case "session:error":
						state.setSessionError(event.sessionId, {
							...event.error,
							receivedAt: Date.now(),
						})
						break

					case "session:error-clear":
						state.clearSessionError(event.sessionId)
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

			// Coalesced git refreshes — at most one `/vcs/status` + one
			// `/vcs/branch` per affected workspace per frame.
			if (needsGitStatus) {
				useFilePanelStore.getState().loadChanges()
			}
			for (const dir of branchRefreshDirs) {
				const wsStore = workspaceStoreRegistry.get(dir)
				if (!wsStore) continue
				apiClient
					.get<{ branch: string; dirty: boolean }>("/vcs/branch", { directory: dir })
					.then((branch) => wsStore.getState().initVcs(branch))
					.catch(() => {})
			}
		})

		// On reconnection: clear streaming buffer and re-bootstrap workspace
		// to recover session statuses and state lost during SSE disconnection.
		// On reconnect, re-bootstrap all directories to recover lost state.
		sseClient.onReconnect(() => {
			streamingBuffer.clear()

			const dir = useUIStore.getState().activeDirectory
			if (!dir) return

			refreshWorkspace(dir).catch((err) => console.error("[sse:reconnect:bootstrap]", err))

			// Recover worktree state — re-fetch list to catch missed ready/failed events
			worktreeApi
				.list(dir)
				.then((sandboxes) => {
					const wtStore = useWorktreeStore.getState()
					for (const s of sandboxes) {
						if (s.status === "ready" && wtStore.worktrees.get(s.directory)?.status === "creating") {
							worktreeState.ready(s.directory)
							wtStore.setWorktreeStatus(s.directory, "ready")
							wtStore.setBusy(s.directory, false)
						}
					}
				})
				.catch(() => {})

			// Pending permissions/questions are NOT cleared on reconnect.
			// They persist until the user explicitly responds. If a permission
			// was resolved during disconnect, the reply API call will fail
			// gracefully and the stale dialog will be cleaned up at that point.
			const store = workspaceStoreRegistry.get(dir)
			if (!store) return

			// Refetch the active session via `ensureSession` — dedupes against any
			// in-flight loader, repopulates session metadata + messages in one shot,
			// retries on transient failure. Events that arrived during the disconnect
			// are lost on the wire but the REST endpoint is the source of truth.
			const storeState = store.getState()
			const activeId = storeState.activeSessionId
			if (activeId) {
				ensureSession(store, activeId, dir).catch((err) =>
					console.error("[sse:reconnect:messages]", err),
				)
			}

			// Refetch all registered child sessions through the same loader.
			for (const childId of storeState.childSessionIds) {
				ensureSession(store, childId, dir).catch((err) =>
					console.error("[sse:reconnect:child]", err),
				)
			}

			// Refresh statuses for non-active workspaces (their full bootstrap is skipped).
			for (const project of useProjectStore.getState().projects) {
				if (project.directory === dir) continue
				const otherStore = workspaceStoreRegistry.get(project.directory)
				if (!otherStore) continue
				apiClient
					.get<Record<string, SessionStatus>>("/sessions/status", {
						directory: project.directory,
					})
					.then((statuses) => {
						const state = otherStore.getState()
						for (const [sid, status] of Object.entries(statuses)) {
							state.setSessionStatus(sid, status)
						}
						state.reconcileSessionStatuses(statuses)
					})
					.catch((err) => console.error("[sse:reconnect:status]", err))
			}
		})

		return () => sseClient.detach()
	}, [])
}
