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
})

export const AssistantMessageMetaSchema = z.object({
	modelId: z.string().optional(),
	finish: z.string().optional(),
	summary: z.boolean().optional(),
})

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
