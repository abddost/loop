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
	},
	(table) => [
		index("session_project_id_idx").on(table.projectId),
		index("session_parent_id_idx").on(table.parentId),
	],
)
