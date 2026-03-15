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
			text: z.string(),
			sessionId: z.string(),
		}),
	}),
	z.object({
		type: z.literal("heartbeat"),
	}),
	z.object({
		type: z.literal("server.connected"),
	}),
])

export type GlobalEvent = z.infer<typeof GlobalEventSchema>
