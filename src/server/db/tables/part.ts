import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { messageTable } from "./message"

export const partTable = sqliteTable(
	"part",
	{
		id: text("id").primaryKey(),
		sessionId: text("session_id").notNull(),
		messageId: text("message_id")
			.notNull()
			.references(() => messageTable.id),
		type: text("type").notNull(),
		ordinal: integer("ordinal").notNull(),
		data: text("data", { mode: "json" }),
		createdAt: integer("created_at", { mode: "number" }).notNull(),
		updatedAt: integer("updated_at", { mode: "number" }).notNull(),
	},
	(table) => [
		index("part_message_ordinal_idx").on(table.messageId, table.ordinal),
		index("part_session_id_idx").on(table.sessionId),
	],
)
