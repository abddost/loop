import { Deferred } from "@core/util/async"
import { createLogger } from "../logger"
import { setSessionStatus } from "../loop/status"
import { Workspace } from "../workspace"
import { bus } from "../workspace/bus"
import { getApprovalPolicy, getUserPermissionConfig } from "./config"
import { buildAgentRuleset, buildFullAccessRuleset } from "./defaults"
import { evaluate } from "./evaluate"
import {
	CorrectedError,
	DeniedError,
	type PermissionReply,
	type PermissionRequest,
	type PermissionRuleset,
	RejectedError,
} from "./types"
import { Wildcard } from "./wildcard"

const log = createLogger("permission")

// ────────────────────────────────────────────────────────────
// State: pending permission requests (per-workspace)
// ────────────────────────────────────────────────────────────

interface PendingEntry {
	info: PermissionRequest
	resolve: () => void
	reject: (err: Error) => void
}

interface PermissionState {
	pending: Map<string, PendingEntry>
	/** Session-scoped "always allow" rules accumulated from user approvals. */
	sessionApproved: Map<string, PermissionRuleset> // sessionId → approved rules
}

export const permissionState = Workspace.state<PermissionState>(
	() => ({
		pending: new Map(),
		sessionApproved: new Map(),
	}),
	(state) => {
		// Reject all pending on workspace dispose
		for (const [, entry] of state.pending) {
			entry.reject(new Error("workspace disposed"))
		}
		state.pending.clear()
		state.sessionApproved.clear()
	},
)

// ────────────────────────────────────────────────────────────
// Resolve the active ruleset for a session + agent
// ────────────────────────────────────────────────────────────

/**
 * Build the effective ruleset for a given agent and session.
 * Merge order: global defaults → agent permission → user config → session overrides.
 *
 * @param agentPermission - The agent's permission ruleset (from agent definition)
 * @param sessionPermissionMode - Session-level mode ("default" | "full-access" | "custom")
 * @param sessionRuleset - Session-level custom rules (only used if mode is "custom")
 */
export function resolveRuleset(
	agentPermission: PermissionRuleset,
	sessionPermissionMode?: string,
	sessionRuleset?: PermissionRuleset,
): PermissionRuleset {
	const policy = getApprovalPolicy()

	// Full access at global level → everything allowed
	if (policy === "full-access") {
		return buildFullAccessRuleset()
	}

	// Session-level full access overrides agent defaults
	if (sessionPermissionMode === "full-access") {
		return buildFullAccessRuleset()
	}

	// Session-level custom → use session ruleset
	if (sessionPermissionMode === "custom" && sessionRuleset) {
		return buildAgentRuleset(agentPermission, getUserPermissionConfig(), sessionRuleset)
	}

	// Default: agent defaults + user config
	return buildAgentRuleset(agentPermission, getUserPermissionConfig())
}

// ────────────────────────────────────────────────────────────
// ask() — the single entry point for permission checking
// ────────────────────────────────────────────────────────────

export interface AskInput {
	/** Unique ID for this request (usually the tool callId). */
	id: string
	/** Session this request belongs to. */
	sessionId: string
	/** Permission type: "bash", "edit", "read", "doom_loop", etc. */
	permission: string
	/** Actual values to check (file paths, commands). */
	patterns: string[]
	/** Broader patterns for "always allow" (e.g., "git checkout *"). */
	always: string[]
	/** The active ruleset for evaluation. */
	ruleset: PermissionRuleset
	/** Extra metadata for the frontend. */
	metadata?: Record<string, any>
	/** Abort signal — rejects the deferred promise if abort fires while waiting. */
	signal?: AbortSignal
}

/**
 * Check permission for a tool call.
 *
 * - If the ruleset says "allow" → resolves immediately.
 * - If the ruleset says "deny" → throws DeniedError.
 * - If the ruleset says "ask" → emits a permission request event,
 *   blocks until the user responds via reply().
 *
 * @throws {DeniedError} if the ruleset denies the action
 * @throws {RejectedError} if the user rejects the action
 * @throws {CorrectedError} if the user rejects with feedback
 */
export async function ask(input: AskInput): Promise<void> {
	const state = permissionState()
	const sessionApproved = state.sessionApproved.get(input.sessionId) ?? []

	for (const pattern of input.patterns) {
		const rule = evaluate(input.permission, pattern, input.ruleset, sessionApproved)

		log.debug("Permission evaluated", {
			permission: input.permission,
			pattern,
			action: rule.action,
		})

		if (rule.action === "deny") {
			throw new DeniedError(
				input.ruleset.filter((r) => Wildcard.match(input.permission, r.permission)),
			)
		}

		if (rule.action === "ask") {
			const deferred = new Deferred<void>()
			const request: PermissionRequest = {
				id: input.id,
				sessionId: input.sessionId,
				permission: input.permission,
				patterns: input.patterns,
				always: input.always,
				metadata: input.metadata ?? {},
			}

			state.pending.set(input.id, {
				info: request,
				resolve: () => {
					deferred.resolve()
				},
				reject: (err) => {
					deferred.reject(err)
				},
			})

			// Signal the frontend that we're waiting for user input
			setSessionStatus(input.sessionId, "awaiting-permission")

			// Emit SSE event for the frontend
			bus().emit("permission:request", {
				sessionId: input.sessionId,
				request: {
					id: request.id,
					sessionId: request.sessionId,
					tool: request.permission,
					input: request.metadata,
					reason: (request.metadata as any)?.reason,
					type: request.permission === "doom_loop" ? "doom_loop" : "tool",
					patterns: request.patterns,
				},
			})

			// If an abort signal was provided, reject the deferred when abort fires.
			// This prevents the permission wait from blocking forever after the user
			// cancels the session (the stream processor catches the error and cleans up).
			let abortHandler: (() => void) | undefined
			if (input.signal) {
				if (input.signal.aborted) {
					deferred.reject(new Error("aborted"))
				} else {
					abortHandler = () => deferred.reject(new Error("aborted"))
					input.signal.addEventListener("abort", abortHandler, { once: true })
				}
			}

			try {
				await deferred.promise
			} finally {
				state.pending.delete(input.id)
				if (abortHandler && input.signal) {
					input.signal.removeEventListener("abort", abortHandler)
				}
			}

			// Restore busy status after permission is granted
			setSessionStatus(input.sessionId, "busy")
			return // Permission was granted, done
		}

		// action === "allow" → continue checking next pattern
	}
}

// ────────────────────────────────────────────────────────────
// reply() — called when the user responds to a permission request
// ────────────────────────────────────────────────────────────

/**
 * Handle a user's reply to a permission request.
 *
 * @param requestId - The permission request ID
 * @param replyType - "once" | "always" | "reject"
 * @param message - Optional feedback message (only for "reject")
 */
export function reply(requestId: string, replyType: PermissionReply, message?: string): void {
	const state = permissionState()
	const entry = state.pending.get(requestId)
	if (!entry) {
		log.warn("Permission reply for unknown request", { requestId })
		return
	}

	state.pending.delete(requestId)

	if (replyType === "reject") {
		const error = message ? new CorrectedError(message) : new RejectedError()
		entry.reject(error)

		// Reject ALL other pending permissions for this session
		const sessionId = entry.info.sessionId
		for (const [id, pending] of state.pending) {
			if (pending.info.sessionId === sessionId) {
				state.pending.delete(id)
				pending.reject(new RejectedError())
			}
		}
		return
	}

	if (replyType === "once") {
		entry.resolve()
		return
	}

	if (replyType === "always") {
		// Add "always allow" rules for the broader patterns
		const sessionId = entry.info.sessionId
		if (!state.sessionApproved.has(sessionId)) {
			state.sessionApproved.set(sessionId, [])
		}
		const approved = state.sessionApproved.get(sessionId)!

		for (const pattern of entry.info.always) {
			approved.push({
				permission: entry.info.permission,
				pattern,
				action: "allow",
			})
		}

		entry.resolve()

		// Auto-resolve any other pending requests in this session
		// that now match the newly approved rules
		for (const [id, pending] of state.pending) {
			if (pending.info.sessionId !== sessionId) continue

			const allAllowed = pending.info.patterns.every((pattern) => {
				const rule = evaluate(pending.info.permission, pattern, approved)
				return rule.action === "allow"
			})

			if (allAllowed) {
				state.pending.delete(id)
				pending.resolve()
			}
		}
	}
}

// ────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────

/** List all pending permission requests. */
export function listPending(): PermissionRequest[] {
	const state = permissionState()
	return [...state.pending.values()].map((e) => e.info)
}

/** Clear session-approved rules (e.g., when session ends). */
export function clearSessionApprovals(sessionId: string): void {
	permissionState().sessionApproved.delete(sessionId)
}

/** Check if there are any pending permissions for a session. */
export function hasPending(sessionId: string): boolean {
	const state = permissionState()
	for (const entry of state.pending.values()) {
		if (entry.info.sessionId === sessionId) return true
	}
	return false
}
