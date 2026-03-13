import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const configTable = sqliteTable("config", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
	updatedAt: integer("updated_at", { mode: "number" }).notNull(),
})
