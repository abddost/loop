import { z } from "zod"

// ────────────────────────────────────────────────────────────
// Permission types used across core and server
// ────────────────────────────────────────────────────────────

export const PermissionActionSchema = z.enum(["allow", "deny", "ask"])
export type PermissionAction = z.infer<typeof PermissionActionSchema>

export const PermissionRuleSchema = z.object({
	permission: z.string(),
	pattern: z.string(),
	action: PermissionActionSchema,
})
export type PermissionRule = z.infer<typeof PermissionRuleSchema>

export const PermissionRulesetSchema = PermissionRuleSchema.array()
export type PermissionRuleset = z.infer<typeof PermissionRulesetSchema>

export const PermissionReplySchema = z.enum(["once", "always", "reject"])
export type PermissionReply = z.infer<typeof PermissionReplySchema>

export const PermissionRequestSchema = z.object({
	id: z.string(),
	sessionId: z.string(),
	tool: z.string(),
	input: z.record(z.unknown()),
	reason: z.string().optional(),
	type: z.enum(["tool", "doom_loop"]),
	/** The actual patterns being checked (for display). */
	patterns: z.string().array().optional(),
	/** Broader patterns for "always allow" option. */
	always: z.string().array().optional(),
})
export type PermissionRequest = z.infer<typeof PermissionRequestSchema>

/**
 * Global approval policy (config file).
 *
 * Only "default" and "full-access" are supported — these are the two modes
 * that `resolveRuleset` handles at the global config level. Claude-Code-only
 * modes ("auto-accept-edits", "plan") live at the session level and are
 * managed by the input bar's PermissionModeSelector.
 */
export const ApprovalPolicySchema = z.enum(["default", "full-access"])
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>

export const SessionPermissionModeSchema = z.enum([
	"default",
	"auto-accept-edits",
	"full-access",
	"plan",
	"custom",
])
export type SessionPermissionMode = z.infer<typeof SessionPermissionModeSchema>

// ────────────────────────────────────────────────────────────
// Config types (for config file)
// ────────────────────────────────────────────────────────────

/** Simple action or pattern-based object for config. */
export const PermissionConfigRuleSchema = z.union([
	PermissionActionSchema,
	z.record(z.string(), PermissionActionSchema),
])
export type PermissionConfigRule = z.infer<typeof PermissionConfigRuleSchema>

/** Full permission config block. */
export const PermissionConfigSchema = z
	.object({
		read: PermissionConfigRuleSchema.optional(),
		edit: PermissionConfigRuleSchema.optional(),
		write: PermissionConfigRuleSchema.optional(),
		glob: PermissionConfigRuleSchema.optional(),
		grep: PermissionConfigRuleSchema.optional(),
		list: PermissionConfigRuleSchema.optional(),
		bash: PermissionConfigRuleSchema.optional(),
		task: PermissionConfigRuleSchema.optional(),
		"web-fetch": PermissionConfigRuleSchema.optional(),
		"web-search": PermissionConfigRuleSchema.optional(),
		doom_loop: PermissionActionSchema.optional(),
	})
	.catchall(PermissionConfigRuleSchema)
export type PermissionConfig = z.infer<typeof PermissionConfigSchema>
