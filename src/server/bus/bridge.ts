import type { GlobalEvent } from "@core/schema/event"
import type { WorkspaceBus, WorkspaceEvents } from "../workspace/bus"
import { globalBus } from "./global"

/**
 * Bridge a workspace bus to the global bus.
 * Attaches the directory field to each event.
 * Returns unsubscribe function.
 */
export function bridgeWorkspaceBus(wsBus: WorkspaceBus, directory: string): () => void {
	const handler = <K extends keyof WorkspaceEvents>(type: K, data: WorkspaceEvents[K]) => {
		globalBus.emit({ type, directory, ...data } as unknown as GlobalEvent)
	}

	wsBus.on("session:status", (data) => handler("session:status", data))
	wsBus.on("session:update", (data) => handler("session:update", data))
	wsBus.on("session:usage", (data) => handler("session:usage", data))
	wsBus.on("message:create", (data) => handler("message:create", data))
	wsBus.on("part:upsert", (data) => handler("part:upsert", data))
	wsBus.on("part:delta", (data) => handler("part:delta", data))
	wsBus.on("permission:request", (data) => handler("permission:request", data))
	wsBus.on("question:request", (data) => handler("question:request", data))
	wsBus.on("vcs:changed", (data) => handler("vcs:changed", data))
	wsBus.on("worktree:ready", (data) => handler("worktree:ready", data))
	wsBus.on("worktree:failed", (data) => handler("worktree:failed", data))
	wsBus.on("worktree:removed", (data) => handler("worktree:removed", data))
	wsBus.on("worktree:reset", (data) => handler("worktree:reset", data))

	return () => {
		wsBus.all.clear()
	}
}
