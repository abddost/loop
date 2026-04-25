import type { SessionStatus } from "@core/schema/session"
import mitt, { type Emitter } from "mitt"
import { Workspace } from "./index"

/** Workspace events (without directory — that's added by GlobalBus bridge) */
export type WorkspaceEvents = {
	"session:status": { sessionId: string; status: SessionStatus }
	"session:update": { sessionId: string; session: any }
	"message:create": { sessionId: string; message: any }
	"part:upsert": { sessionId: string; messageId: string; part: any }
	"part:delta": {
		sessionId: string
		messageId: string
		partId: string
		delta: string
		partType?: "text" | "reasoning"
	}
	"session:usage": {
		sessionId: string
		usage: {
			input: number
			output: number
			reasoning?: number
			cacheRead?: number
			cacheWrite?: number
		}
		cost: number
		contextWindow: number
	}
	"permission:request": { sessionId: string; request: any }
	"question:request": { sessionId: string; question: any }
	"session:error": {
		sessionId: string
		error: {
			severity: "error" | "warning"
			source: "runtime" | "auth" | "cli" | "rate-limit" | "tool" | "stream" | "provider"
			message: string
			details?: string
			recoverable?: boolean
		}
	}
	"session:error-clear": { sessionId: string }
	"mcp:status": { name: string; status: string; error?: string; toolCount?: number }
	"file:changed": { path: string; event: "add" | "change" | "unlink" }
	"git:changed": Record<string, never>
	"worktree:ready": { sandboxId: string; worktreeDirectory: string; branch: string }
	"worktree:failed": { sandboxId: string; worktreeDirectory: string; error: string }
	"worktree:removed": { sandboxId: string }
	"worktree:reset": { sandboxId: string }
}

export type WorkspaceBus = Emitter<WorkspaceEvents>

/**
 * Per-workspace event bus. Zero-arg access.
 * Created lazily on first bus() call per workspace.
 * Disposed automatically when workspace closes.
 */
export const bus = Workspace.state<WorkspaceBus>(
	() => mitt<WorkspaceEvents>(),
	(b) => b.all.clear(),
)
