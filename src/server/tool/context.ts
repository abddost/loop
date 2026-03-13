import { Deferred } from "@core/util/async"
import { bus } from "../workspace/bus"
import { pendingPermissions } from "./permission"
import type { Tool } from "./shape"

/**
 * Build a Tool.Context for a specific tool call execution.
 * Wires up metadata streaming and permission asking via the workspace bus.
 */
export function createToolContext(params: {
	sessionId: string
	messageId: string
	agent: string
	signal: AbortSignal
	callId: string
	toolName: string
	messages: any[]
}): Tool.Context {
	const { sessionId, messageId, agent, signal, callId, toolName, messages } = params

	return {
		sessionId,
		messageId,
		agent,
		signal,
		callId,
		messages,

		metadata(input) {
			bus().emit("part:upsert", {
				sessionId,
				messageId,
				part: { id: callId, type: "tool", metadata: input },
			})
		},

		async ask(input) {
			const id = callId
			const deferred = new Deferred<boolean>()
			const permissions = pendingPermissions()

			permissions.set(id, deferred)

			bus().emit("permission:request", {
				sessionId,
				request: {
					id,
					sessionId,
					tool: toolName,
					input: {},
					reason: input.reason,
					type: input.type ?? "tool",
				},
			})

			try {
				return await deferred.promise
			} finally {
				permissions.delete(id)
			}
		},
	}
}
