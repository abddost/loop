import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { projectTable } from "./project"

export const sessionTable = sqliteTable(
	"session",
	{
		id: text("id").primaryKey(),
		projectId: text("project_id")
			.notNull()
			.references(() => projectTable.id),
		parentId: text("parent_id"),
		directory: text("directory").notNull(),
		title: text("title"),
		permissionMode: text("permission_mode").notNull().default("default"),
		permission: text("permission", { mode: "json" }),
		revertState: text("revert_state", { mode: "json" }),
		compactedAt: integer("compacted_at", { mode: "number" }),
		archivedAt: integer("archived_at", { mode: "number" }),
		createdAt: integer("created_at", { mode: "number" }).notNull(),
		updatedAt: integer("updated_at", { mode: "number" }).notNull(),
		// ─── Claude Code CLI resume state ───
		// When the session's last turn ran through the Claude Code CLI
		// runtime, we persist the SDK-assigned session_id here so a
		// subsequent prompt can resume the conversation (even across app
		// restarts). `claudeCodeCwd` is the working dir the CLI saw at
		// resume time — if it no longer exists we reset and start fresh.
		// `claudeCodeLastTurnId` tracks the last CLI message UUID so we can
		// scope snapshots/reverts to a specific turn.
		claudeCodeSessionId: text("claude_code_session_id"),
		claudeCodeCwd: text("claude_code_cwd"),
		claudeCodeLastTurnId: text("claude_code_last_turn_id"),
		// ─── Cursor SDK resume state ───
		// `Agent.create()` from @cursor/sdk returns a stable `agentId` (e.g.
		// `agent-<uuid>` for local, `bc-<uuid>` for cloud) which is the unit
		// of conversation state. We persist it so subsequent prompts can
		// `Agent.resume(agentId)` instead of starting a fresh conversation.
		// `cursorCwd` is the working directory at create-time — if it no
		// longer exists we reset and start fresh.
		cursorAgentId: text("cursor_agent_id"),
		cursorCwd: text("cursor_cwd"),
	},
	(table) => [
		index("session_project_id_idx").on(table.projectId),
		index("session_parent_id_idx").on(table.parentId),
	],
)
