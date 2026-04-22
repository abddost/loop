import { z } from "zod"
import { PartSchema } from "./part"

export const UserMessageMetaSchema = z.object({
	agent: z.string().optional(),
	model: z
		.object({
			modelId: z.string(),
			providerId: z.string(),
		})
		.optional(),
	system: z.string().optional(),
	tools: z.record(z.string(), z.boolean()).optional(),
	summary: z
		.object({
			title: z.string(),
			body: z.string(),
			diffs: z.string().optional(),
		})
		.optional(),
	option: z.string().optional(),
	/** Reasoning effort override for this prompt (low/medium/high). */
	reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
	/** True when the message was created by a tool (e.g. plan_exit) rather than the user. */
	synthetic: z.boolean().optional(),
})

export const AssistantMessageMetaSchema = z.object({
	modelId: z.string().optional(),
	providerId: z.string().optional(),
	finish: z.string().optional(),
	summary: z.boolean().optional(),
	/** Which agent produced this assistant message. */
	agent: z.string().optional(),
	/**
	 * Accumulated token usage for this turn. Populated at turn finalize on
	 * both the main @ai-sdk path and the Claude Code adapter path so the
	 * UsageBar can re-derive context-window state after an app reload.
	 */
	tokens: z
		.object({
			input: z.number(),
			output: z.number(),
			reasoning: z.number().optional(),
			cacheRead: z.number().optional(),
			cacheWrite: z.number().optional(),
		})
		.optional(),
	cost: z.number().optional(),
	contextWindow: z.number().optional(),
})

export type AssistantMessageMeta = z.infer<typeof AssistantMessageMetaSchema>

export const MessageSchema = z.object({
	id: z.string(),
	sessionId: z.string(),
	role: z.enum(["user", "assistant"]),
	metadata: z.union([UserMessageMetaSchema, AssistantMessageMetaSchema]).optional(),
	createdAt: z.number(),
	updatedAt: z.number(),
})

export type Message = z.infer<typeof MessageSchema>

export const MessageWithPartsSchema = MessageSchema.extend({
	parts: z.array(PartSchema),
})

export type MessageWithParts = z.infer<typeof MessageWithPartsSchema>
