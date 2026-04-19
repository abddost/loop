import type { PermissionReply } from "@core/schema/permission"
import { Deferred } from "@core/util/async"
import { createLogger } from "../../logger"
import { CorrectedError, RejectedError } from "../../permission/types"
import { bus } from "../../workspace/bus"
import { setSessionStatus } from "../status"

/**
 * Plan approval system for Claude Code's `ExitPlanMode` tool.
 *
 * Separated from the generic permission module because plan approval has
 * different semantics:
 *   - "once"   → Accept plan, switch to "default" permission mode
 *   - "always" → Accept plan, switch to "acceptEdits" permission mode
 *   - "reject" → Revise plan (send feedback back to Claude)
 *
 * Reuses the same bus event shape (`permission:request`) so the existing
 * SSE pipeline delivers it to the frontend, but the frontend renders a
 * `PlanApprovalDialog` instead of `PermissionDialog` when `type` is
 * `"plan_approval"`.
 */

const log = createLogger("claude-code-plan-approval")

interface PendingPlanApproval {
	deferred: Deferred<PermissionReply>
	sessionId: string
}

/** Module-level map of pending plan approvals. */
const pending = new Map<string, PendingPlanApproval>()

/**
 * Ask the user to approve a plan proposed by Claude Code.
 *
 * Emits a `permission:request` bus event with `type: "plan_approval"` and
 * blocks until the user responds. Returns the reply type so the caller
 * can decide which SDK permission mode to switch to.
 *
 * @throws {CorrectedError} if the user provides revision feedback
 * @throws {RejectedError} if the user dismisses without feedback
 */
export async function askPlanApproval(
	requestId: string,
	sessionId: string,
	signal?: AbortSignal,
): Promise<PermissionReply> {
	const deferred = new Deferred<PermissionReply>()
	pending.set(requestId, { deferred, sessionId })

	setSessionStatus(sessionId, "awaiting-permission")

	bus().emit("permission:request", {
		sessionId,
		request: {
			id: requestId,
			sessionId,
			tool: "ExitPlanMode",
			input: {},
			reason: "Claude proposed a plan",
			type: "plan_approval",
			patterns: [],
		},
	})

	let abortHandler: (() => void) | undefined
	if (signal) {
		if (signal.aborted) {
			pending.delete(requestId)
			throw new Error("aborted")
		}
		abortHandler = () => {
			pending.delete(requestId)
			deferred.reject(new Error("aborted"))
		}
		signal.addEventListener("abort", abortHandler, { once: true })
	}

	try {
		return await deferred.promise
	} finally {
		pending.delete(requestId)
		if (abortHandler && signal) {
			signal.removeEventListener("abort", abortHandler)
		}
		setSessionStatus(sessionId, "busy")
	}
}

/**
 * Resolve a pending plan approval.
 *
 * Called from the permission reply route when the request ID belongs to
 * a plan approval (identified by `cc:plan:` prefix).
 */
export function replyPlanApproval(
	requestId: string,
	replyType: PermissionReply,
	message?: string,
): void {
	const entry = pending.get(requestId)
	if (!entry) {
		log.warn("Plan approval reply for unknown request", { requestId })
		return
	}

	pending.delete(requestId)

	if (replyType === "reject") {
		const error = message ? new CorrectedError(message) : new RejectedError()
		entry.deferred.reject(error)
	} else {
		entry.deferred.resolve(replyType)
	}
}

/** Check whether a request ID belongs to the plan approval system. */
export function isPlanApprovalRequest(requestId: string): boolean {
	return requestId.startsWith("cc:plan:")
}

/** Clean up any pending plan approvals for a session (e.g., on abort). */
export function clearPendingPlanApprovals(sessionId: string): void {
	for (const [id, entry] of pending) {
		if (entry.sessionId === sessionId) {
			pending.delete(id)
			entry.deferred.reject(new Error("session ended"))
		}
	}
}
