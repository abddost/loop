import { z } from "zod"

// ────────────────────────────────────────────────────────────
// Re-export all permission types from core (single source of truth)
// ────────────────────────────────────────────────────────────

export type {
	PermissionAction,
	PermissionRule,
	PermissionRuleset,
	PermissionReply,
	PermissionConfigRule,
	PermissionConfig,
	ApprovalPolicy,
	SessionPermissionMode,
} from "@core/schema/permission"

// ────────────────────────────────────────────────────────────
// Server-internal permission request (different from the frontend-facing
// PermissionRequestSchema in @core/schema/permission)
// ────────────────────────────────────────────────────────────

export const PermissionRequest = z.object({
	id: z.string(),
	sessionId: z.string(),
	permission: z.string(), // "bash", "edit", "doom_loop", etc.
	patterns: z.string().array(), // actual values (file paths, commands)
	always: z.string().array(), // broader patterns for "always allow"
	metadata: z.record(z.string(), z.any()),
})
export type PermissionRequest = z.infer<typeof PermissionRequest>

// ────────────────────────────────────────────────────────────
// Error types (server-only)
// ────────────────────────────────────────────────────────────

/** User explicitly rejected a permission request. Halts tool execution. */
export class RejectedError extends Error {
	constructor() {
		super("The user rejected permission to use this tool call.")
		this.name = "RejectedError"
	}
}

/** User rejected with feedback message. Halts tool but provides guidance. */
export class CorrectedError extends Error {
	constructor(message: string) {
		super(`The user rejected permission with the following feedback: ${message}`)
		this.name = "CorrectedError"
	}
}

/** Config rule prevents the tool call. Shows relevant rules. */
export class DeniedError extends Error {
	constructor(public readonly ruleset: import("@core/schema/permission").PermissionRuleset) {
		super(`A permission rule prevents this tool call. Relevant rules: ${JSON.stringify(ruleset)}`)
		this.name = "DeniedError"
	}
}
