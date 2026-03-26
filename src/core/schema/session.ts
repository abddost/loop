import { z } from "zod"
import { FileDiffSchema } from "./part"
import { PermissionRulesetSchema, SessionPermissionModeSchema } from "./permission"

export const RevertStateSchema = z.object({
	messageId: z.string(),
	partId: z.string().optional(),
	/** Pre-revert snapshot hash, used for unrevert. */
	snapshot: z.string().optional(),
	/** Diff of what was undone. */
	diff: z.array(FileDiffSchema).optional(),
})

export type RevertState = z.infer<typeof RevertStateSchema>

export const SessionSchema = z.object({
	id: z.string(),
	projectId: z.string(),
	directory: z.string(),
	title: z.string().nullable(),
	/** Session-level permission mode: "default" | "full-access" | "custom" */
	permissionMode: SessionPermissionModeSchema.default("default"),
	/** Custom permission ruleset (only used when permissionMode is "custom"). */
	permission: PermissionRulesetSchema.nullable(),
	/** Revert state: set when a user reverts assistant changes. */
	revertState: RevertStateSchema.nullable().optional(),
	compactedAt: z.number().nullable(),
	archivedAt: z.number().nullable(),
	createdAt: z.number(),
	updatedAt: z.number(),
})

export type Session = z.infer<typeof SessionSchema>

/** Rich retry status with attempt info for UI display. */
export const RetryStatusSchema = z.object({
	type: z.literal("retry"),
	/** Current retry attempt number (1-based). */
	attempt: z.number(),
	/** Human-readable reason (e.g. "Provider is overloaded"). */
	message: z.string(),
	/** Unix timestamp (ms) when the next retry will fire. */
	next: z.number(),
})

export type RetryStatus = z.infer<typeof RetryStatusSchema>

/**
 * Session status — either a simple string literal or a rich retry object.
 * String statuses are backward-compatible with all existing callers.
 */
export const SessionStatusSchema = z.union([
	z.enum(["idle", "busy", "compacting", "awaiting-permission", "awaiting-question"]),
	RetryStatusSchema,
])

export type SessionStatus = z.infer<typeof SessionStatusSchema>
