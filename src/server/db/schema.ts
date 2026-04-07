import { relations } from "drizzle-orm"
import { messageTable } from "./tables/message"
import { partTable } from "./tables/part"
import { projectTable } from "./tables/project"
import { sandboxTable } from "./tables/sandbox"
import { sessionTable } from "./tables/session"

export * from "./tables/config"
export * from "./tables/project"
export * from "./tables/sandbox"
export * from "./tables/session"
export * from "./tables/message"
export * from "./tables/part"

// ─── Relations ───────────────────────────────────────────────────

export const projectRelations = relations(projectTable, ({ many }) => ({
	sessions: many(sessionTable),
	sandboxes: many(sandboxTable),
}))

export const sandboxRelations = relations(sandboxTable, ({ one }) => ({
	project: one(projectTable, {
		fields: [sandboxTable.projectId],
		references: [projectTable.id],
	}),
}))

export const sessionRelations = relations(sessionTable, ({ one, many }) => ({
	project: one(projectTable, {
		fields: [sessionTable.projectId],
		references: [projectTable.id],
	}),
	messages: many(messageTable),
	parts: many(partTable),
}))

export const messageRelations = relations(messageTable, ({ one, many }) => ({
	session: one(sessionTable, {
		fields: [messageTable.sessionId],
		references: [sessionTable.id],
	}),
	parts: many(partTable),
}))

export const partRelations = relations(partTable, ({ one }) => ({
	message: one(messageTable, {
		fields: [partTable.messageId],
		references: [messageTable.id],
	}),
	session: one(sessionTable, {
		fields: [partTable.sessionId],
		references: [sessionTable.id],
	}),
}))
