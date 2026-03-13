import { z } from "zod"

export const PermissionRuleSchema = z.object({
	tool: z.string(),
	allow: z.boolean(),
	prefix: z.string().optional(),
})

export const PermissionRulesetSchema = z.object({
	mode: z.enum(["default", "ask-always", "allow-all"]),
	rules: z.array(PermissionRuleSchema),
})

export type PermissionRuleset = z.infer<typeof PermissionRulesetSchema>

/** Permission request sent to the frontend. */
export const PermissionRequestSchema = z.object({
	id: z.string(),
	sessionId: z.string(),
	tool: z.string(),
	input: z.record(z.unknown()),
	reason: z.string().optional(),
	type: z.enum(["tool", "doom_loop"]),
})

export type PermissionRequest = z.infer<typeof PermissionRequestSchema>
