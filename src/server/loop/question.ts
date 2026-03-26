import type { Deferred } from "@core/util/async"
import { RejectedError } from "../permission/types"
import { Workspace } from "../workspace"

/**
 * Pending questions. Maps questionId to a Deferred<string[]>.
 * Each entry resolves with an array of answers (one per question in the batch).
 * Rejected with RejectedError when the user dismisses or the session is cancelled.
 */
export const pendingQuestions = Workspace.state(
	() => new Map<string, Deferred<string[]>>(),
	(map) => {
		for (const [, d] of map) {
			if (!d.settled) d.reject(new RejectedError())
		}
		map.clear()
	},
)
