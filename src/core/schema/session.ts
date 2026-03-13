import { z } from "zod"
import { PermissionRulesetSchema } from "./permission"

export const SessionSchema = z.object({
	id: z.string(),
	projectId: z.string(),
	directory: z.string(),
	title: z.string().nullable(),
	permission: PermissionRulesetSchema.nullable(),
	compactedAt: z.number().nullable(),
	archivedAt: z.number().nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
})

export type Session = z.infer<typeof SessionSchema>

export const SessionStatusSchema = z.enum([
	"idle",
	"busy",
	"retry",
	"awaiting-permission",
	"awaiting-question",
])

export type SessionStatus = z.infer<typeof SessionStatusSchema>
