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

// ─── Shared Types ────────────────────────────────────────────

export const FileDiffSchema = z.object({
	path: z.string(),
	additions: z.number(),
	deletions: z.number(),
	status: z.enum(["added", "deleted", "modified"]).default("modified"),
})

export const EditFileSchema = z.object({
	path: z.string(),
	additions: z.number().default(0),
	deletions: z.number().default(0),
	status: z.enum(["added", "deleted", "modified"]).default("modified"),
})

export const EditPartSchema = z.object({
	type: z.literal("edit"),
	hash: z.string(),
	/** Array of file paths (legacy) or rich file objects with diff stats. */
	files: z.array(z.union([z.string(), EditFileSchema])),
	totalAdditions: z.number().optional(),
	totalDeletions: z.number().optional(),
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

// ─── /usage Part ─────────────────────────────────────────────

/**
 * Per-model breakdown displayed in the Usage card's Models tab.
 */
export const UsageModelStatsSchema = z.object({
	modelId: z.string(),
	displayName: z.string().optional(),
	tokens: z.number(),
	input: z.number(),
	output: z.number(),
	cached: z.number(),
	cost: z.number(),
})

/**
 * Result of the `/usage` slash command. Persisted as a synthetic
 * assistant message so the user can scroll back to past snapshots.
 *
 * `range` is the time window the snapshot was computed over: `all` =
 * lifetime, `30d`/`7d` = trailing days. `heatmap` is a flat array of
 * day buckets with their message counts in chronological order — the
 * card builds the calendar grid from it.
 */
export const UsagePartSchema = z.object({
	type: z.literal("usage"),
	range: z.enum(["all", "30d", "7d"]),
	stats: z.object({
		sessions: z.number(),
		messages: z.number(),
		totalTokens: z.number(),
		activeDays: z.number(),
		currentStreak: z.number(),
		longestStreak: z.number(),
		/** 0-23, hour of day with the most messages. -1 when there's no
		 *  activity yet. */
		peakHour: z.number(),
		favoriteModel: z.string().nullable(),
		totalCost: z.number(),
	}),
	models: z.array(UsageModelStatsSchema),
	heatmap: z.array(
		z.object({
			/** ISO date `YYYY-MM-DD`. */
			date: z.string(),
			messages: z.number(),
		}),
	),
	/** Optional fun comparison line, e.g. "~1230× more tokens than Animal Farm." */
	comparison: z.string().optional(),
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
	SubtaskPartSchema,
	UsagePartSchema,
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
	UsagePartSchema,
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
export type FileDiff = z.infer<typeof FileDiffSchema>
export type EditFile = z.infer<typeof EditFileSchema>
export type EditPart = z.infer<typeof EditPartSchema>
export type RetryPart = z.infer<typeof RetryPartSchema>
export type SnapshotPart = z.infer<typeof SnapshotPartSchema>
export type UsageModelStats = z.infer<typeof UsageModelStatsSchema>
export type UsagePart = z.infer<typeof UsagePartSchema>

export type UserPart = z.infer<typeof UserPartSchema>
export type AssistantPart = z.infer<typeof AssistantPartSchema>
export type Part = z.infer<typeof PartSchema>
