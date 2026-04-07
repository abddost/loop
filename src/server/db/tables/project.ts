import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const projectTable = sqliteTable("project", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	directory: text("directory").notNull().unique(),
	worktree: text("worktree"),
	/** Shared .git directory (from git rev-parse --git-common-dir). All worktrees share this. */
	gitCommonDir: text("git_common_dir"),
	vcs: text("vcs"),
	createdAt: integer("created_at", { mode: "number" }).notNull(),
	updatedAt: integer("updated_at", { mode: "number" }).notNull(),
})
