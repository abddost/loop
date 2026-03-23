import type { PermissionRuleset } from "@core/schema/permission"
import * as Database from "../db"
import * as queries from "../db/queries"
import { ask as permissionAsk } from "../permission/permission"
import { bus } from "../workspace/bus"
import type { Tool } from "./shape"

/**
 * Create a Tool.Context for executing a tool within a session.
 *
 * The context provides:
 * - Session/message/agent metadata
 * - AbortSignal for cancellation
 * - metadata() for streaming updates to the frontend (persisted to DB)
 * - ask() for permission checking via the centralized permission system
 *
 * @param onMetadata Optional callback to track accumulated metadata
 *   (used by the stream processor to merge with result.metadata on completion).
 */
export function createToolContext(params: {
	sessionId: string
	messageId: string
	agent: string
	signal: AbortSignal
	callId: string
	partId: string
	toolName: string
	messages: any[]
	ruleset: PermissionRuleset
	onMetadata?: (metadata: Record<string, unknown>) => void
}): Tool.Context {
	const { sessionId, messageId, agent, signal, callId, partId, messages, ruleset } = params

	return {
		sessionId,
		messageId,
		agent,
		signal,
		callId,
		messages,

		metadata(input) {
			// Track metadata in the correlation for merge on completion
			if (input.metadata) {
				params.onMetadata?.(input.metadata)
			}

			// Persist to DB so metadata survives page refetches/reconnects,
			// then emit to bus for real-time frontend updates.
			Database.withEffects((_tx, effect) => {
				queries.upsertPart({
					id: partId,
					sessionId,
					messageId,
					type: "tool",
					data: {
						type: "tool",
						callId,
						tool: params.toolName,
						state: "running",
						metadata: input.metadata,
					},
				})

				effect(() => {
					bus().emit("part:upsert", {
						sessionId,
						messageId,
						part: {
							id: partId,
							type: "tool",
							callId,
							tool: params.toolName,
							state: "running" as const,
							metadata: input.metadata,
						},
					})
				})
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
				signal,
				metadata: {
					...input.metadata,
					reason: input.metadata?.reason,
				},
			})
		},
	}
}
