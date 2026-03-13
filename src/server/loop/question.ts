import type { Deferred } from "@core/util/async"
import { Workspace } from "../workspace"

/**
 * Pending questions. Maps questionId to a Deferred<string>.
 * Resolved when the user responds via POST /questions/:id.
 */
export const pendingQuestions = Workspace.state(
	() => new Map<string, Deferred<string>>(),
	(map) => {
		for (const [, d] of map) {
			if (!d.settled) d.reject(new Error("workspace disposed"))
		}
		map.clear()
	},
)
