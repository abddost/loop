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
	"mcp:status": { name: string; status: string; error?: string; toolCount?: number }
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
