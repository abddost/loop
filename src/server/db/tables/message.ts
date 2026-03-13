import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { sessionTable } from "./session"

export const messageTable = sqliteTable(
	"message",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id")
			.notNull()
			.references(() => sessionTable.id),
		role: text("role").notNull(),
		metadata: text("metadata", { mode: "json" }),
		ordinal: integer("ordinal").notNull(),
		createdAt: integer("created_at", { mode: "number" }).notNull(),
		updatedAt: integer("updated_at", { mode: "number" }).notNull(),
	},
	(table) => [
		index("message_session_id_idx").on(table.sessionId),
		index("message_session_ordinal_idx").on(table.sessionId, table.ordinal),
	],
)
