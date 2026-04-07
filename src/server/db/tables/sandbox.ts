import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const sandboxTable = sqliteTable("sandbox", {
	id: text("id").primaryKey(),
	projectId: text("project_id").notNull(),
	name: text("name").notNull(),
	directory: text("directory").notNull().unique(),
	branch: text("branch").notNull(),
	/** creating | ready | failed | removing */
	status: text("status").notNull().default("creating"),
	createdAt: integer("created_at", { mode: "number" }).notNull(),
	updatedAt: integer("updated_at", { mode: "number" }).notNull(),
})
