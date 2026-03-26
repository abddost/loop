import { z } from "zod"
import { MessageWithPartsSchema } from "./message"
import { PartSchema } from "./part"
import { PermissionReplySchema, PermissionRequestSchema } from "./permission"
import { SessionSchema, SessionStatusSchema } from "./session"

export const GlobalEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("session:status"),
		directory: z.string(),
		sessionId: z.string(),
		status: SessionStatusSchema,
	}),
	z.object({
		type: z.literal("session:update"),
		directory: z.string(),
		sessionId: z.string(),
		session: SessionSchema,
	}),
	z.object({
		type: z.literal("message:create"),
		directory: z.string(),
		sessionId: z.string(),
		message: MessageWithPartsSchema,
	}),
	z.object({
		type: z.literal("part:upsert"),
		directory: z.string(),
		sessionId: z.string(),
		messageId: z.string(),
		part: PartSchema,
	}),
	z.object({
		type: z.literal("part:delta"),
		directory: z.string(),
		sessionId: z.string(),
		messageId: z.string(),
		partId: z.string(),
		delta: z.string(),
		partType: z.enum(["text", "reasoning"]).optional(),
	}),
	z.object({
		type: z.literal("session:usage"),
		directory: z.string(),
		sessionId: z.string(),
		usage: z.object({
			input: z.number(),
			output: z.number(),
			reasoning: z.number().optional(),
			cacheRead: z.number().optional(),
			cacheWrite: z.number().optional(),
		}),
		cost: z.number(),
		contextWindow: z.number(),
	}),
	z.object({
		type: z.literal("permission:request"),
		directory: z.string(),
		sessionId: z.string(),
		request: PermissionRequestSchema,
	}),
	z.object({
		type: z.literal("permission:replied"),
		directory: z.string(),
		sessionId: z.string(),
		requestId: z.string(),
		reply: PermissionReplySchema,
	}),
	z.object({
		type: z.literal("question:request"),
		directory: z.string(),
		sessionId: z.string(),
		question: z.object({
			id: z.string(),
			sessionId: z.string(),
			/** Source tool name for filtering (e.g. "question", "plan_enter"). */
			tool: z.string().optional(),
			/** Structured questions with options (question tool). */
			questions: z
				.array(
					z.object({
						question: z.string(),
						options: z
							.array(z.object({ label: z.string(), description: z.string().optional() }))
							.optional(),
						multiple: z.boolean().optional(),
					}),
				)
				.optional(),
			/** Simple text fallback (plan tools). */
			text: z.string().optional(),
		}),
	}),
	z.object({
		type: z.literal("project:delete"),
		projectId: z.string(),
	}),
	z.object({
		type: z.literal("heartbeat"),
	}),
	z.object({
		type: z.literal("server.connected"),
	}),
])

export type GlobalEvent = z.infer<typeof GlobalEventSchema>
