import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const projectTable = sqliteTable("project", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	directory: text("directory").notNull().unique(),
	worktree: text("worktree"),
	vcs: text("vcs"),
	createdAt: integer("created_at", { mode: "number" }).notNull(),
	updatedAt: integer("updated_at", { mode: "number" }).notNull(),
})
