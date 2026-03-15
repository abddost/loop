import type { PermissionRuleset } from "@core/schema/permission"
import { ask as permissionAsk } from "../permission/permission"
import { bus } from "../workspace/bus"
import type { Tool } from "./shape"

/**
 * Create a Tool.Context for executing a tool within a session.
 *
 * The context provides:
 * - Session/message/agent metadata
 * - AbortSignal for cancellation
 * - metadata() for streaming updates to the frontend
 * - ask() for permission checking via the centralized permission system
 */
export function createToolContext(params: {
	sessionId: string
	messageId: string
	agent: string
	signal: AbortSignal
	callId: string
	toolName: string
	messages: any[]
	ruleset: PermissionRuleset
}): Tool.Context {
	const { sessionId, messageId, agent, signal, callId, messages, ruleset } = params

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
			await permissionAsk({
				id: callId,
				sessionId,
				permission: input.permission,
				patterns: input.patterns,
				always: input.always,
				ruleset,
				metadata: {
					...input.metadata,
					reason: input.metadata?.reason,
				},
			})
		},
	}
}
