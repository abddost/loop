import { z } from "zod"

// ─── User Message Parts ───────────────────────────────────────────

export const TextPartSchema = z.object({
	type: z.literal("text"),
	text: z.string(),
	synthetic: z.boolean().optional(),
	ignored: z.boolean().optional(),
})

export const FilePartSchema = z.object({
	type: z.literal("file"),
	path: z.string(),
	mimeType: z.string(),
	content: z.string(),
})

export const SubtaskPartSchema = z.object({
	type: z.literal("subtask"),
	sessionId: z.string(),
	description: z.string(),
	agent: z.string(),
	command: z.string().optional(),
})

export const CompactionPartSchema = z.object({
	type: z.literal("compaction"),
	auto: z.boolean(),
})

// ─── Assistant Message Parts ──────────────────────────────────────

export const StepStartPartSchema = z.object({
	type: z.literal("step-start"),
	snapshot: z.string().optional(),
})

export const ReasoningPartSchema = z.object({
	type: z.literal("reasoning"),
	text: z.string(),
	time: z
		.object({
			start: z.number(),
			end: z.number(),
		})
		.optional(),
	providerMetadata: z.record(z.unknown()).optional(),
})

export const ToolPartSchema = z.object({
	type: z.literal("tool"),
	callId: z.string(),
	tool: z.string(),
	state: z.enum(["pending", "running", "completed", "error"]),
	input: z.record(z.unknown()).optional(),
	output: z.string().optional(),
	error: z.string().optional(),
	time: z
		.object({
			start: z.number().optional(),
			end: z.number().optional(),
			compacted: z.boolean().optional(),
		})
		.optional(),
	metadata: z.record(z.unknown()).optional(),
})

export const StepFinishPartSchema = z.object({
	type: z.literal("step-finish"),
	finishReason: z.string(),
	usage: z
		.object({
			input: z.number(),
			output: z.number(),
			reasoning: z.number().optional(),
			cacheRead: z.number().optional(),
			cacheWrite: z.number().optional(),
		})
		.optional(),
	cost: z.number().optional(),
	snapshot: z.string().optional(),
	sources: z
		.array(
			z.object({
				url: z.string(),
				title: z.string().optional(),
			}),
		)
		.optional(),
})

export const EditPartSchema = z.object({
	type: z.literal("edit"),
	hash: z.string(),
	files: z.array(z.string()),
})

export const RetryPartSchema = z.object({
	type: z.literal("retry"),
	error: z.string(),
	attempt: z.number(),
	timestamp: z.number(),
})

export const SnapshotPartSchema = z.object({
	type: z.literal("snapshot"),
	commitHash: z.string(),
})

// ─── Discriminated Unions ─────────────────────────────────────────

export const UserPartSchema = z.discriminatedUnion("type", [
	TextPartSchema,
	FilePartSchema,
	CompactionPartSchema,
])

export const AssistantPartSchema = z.discriminatedUnion("type", [
	TextPartSchema,
	StepStartPartSchema,
	ReasoningPartSchema,
	ToolPartSchema,
	StepFinishPartSchema,
	EditPartSchema,
	RetryPartSchema,
	SnapshotPartSchema,
	SubtaskPartSchema
])

export const PartSchema = z.discriminatedUnion("type", [
	TextPartSchema,
	FilePartSchema,
	SubtaskPartSchema,
	CompactionPartSchema,
	StepStartPartSchema,
	ReasoningPartSchema,
	ToolPartSchema,
	StepFinishPartSchema,
	EditPartSchema,
	RetryPartSchema,
	SnapshotPartSchema,
])

// ─── Inferred Types ──────────────────────────────────────────────

export type TextPart = z.infer<typeof TextPartSchema>
export type FilePart = z.infer<typeof FilePartSchema>
export type SubtaskPart = z.infer<typeof SubtaskPartSchema>
export type CompactionPart = z.infer<typeof CompactionPartSchema>
export type StepStartPart = z.infer<typeof StepStartPartSchema>
export type ReasoningPart = z.infer<typeof ReasoningPartSchema>
export type ToolPart = z.infer<typeof ToolPartSchema>
export type StepFinishPart = z.infer<typeof StepFinishPartSchema>
export type EditPart = z.infer<typeof EditPartSchema>
export type RetryPart = z.infer<typeof RetryPartSchema>
export type SnapshotPart = z.infer<typeof SnapshotPartSchema>

export type UserPart = z.infer<typeof UserPartSchema>
export type AssistantPart = z.infer<typeof AssistantPartSchema>
export type Part = z.infer<typeof PartSchema>
