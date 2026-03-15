import { z } from "zod"
import { PermissionRulesetSchema, SessionPermissionModeSchema } from "./permission"

export const SessionSchema = z.object({
	id: z.string(),
	projectId: z.string(),
	directory: z.string(),
	title: z.string().nullable(),
	/** Session-level permission mode: "default" | "full-access" | "custom" */
	permissionMode: SessionPermissionModeSchema.default("default"),
	/** Custom permission ruleset (only used when permissionMode is "custom"). */
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
