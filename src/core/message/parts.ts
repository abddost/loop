import type {
	CompactionPart,
	EditPart,
	FilePart,
	ReasoningPart,
	RetryPart,
	SnapshotPart,
	StepFinishPart,
	StepStartPart,
	SubtaskPart,
	TextPart,
	ToolPart,
} from "../schema/part"

/**
 * Creates a TextPart with optional flags.
 * @param text - The text content
 * @param opts - Optional synthetic and ignored flags
 * @returns A TextPart object
 */
export function createTextPart(
	text: string,
	opts?: { synthetic?: boolean; ignored?: boolean },
): TextPart {
	return {
		type: "text",
		text,
		...opts,
	}
}

/**
 * Creates a FilePart for embedding file content.
 * @param path - The file path
 * @param mimeType - The MIME type of the file
 * @param content - The file content as a data URL
 * @returns A FilePart object
 */
export function createFilePart(path: string, mimeType: string, content: string): FilePart {
	return { type: "file", path, mimeType, content }
}

/**
 * Creates a SubtaskPart for delegating work to a subagent.
 * @param sessionId - The subtask session ID
 * @param description - Description of the subtask
 * @param agent - The agent handling the subtask
 * @param command - Optional command string
 * @returns A SubtaskPart object
 */
export function createSubtaskPart(
	sessionId: string,
	description: string,
	agent: string,
	command?: string,
): SubtaskPart {
	return {
		type: "subtask",
		sessionId,
		description,
		agent,
		...(command !== undefined ? { command } : {}),
	}
}

/**
 * Creates a CompactionPart marking a compaction boundary.
 * @param auto - Whether the compaction was automatic
 * @returns A CompactionPart object
 */
export function createCompactionPart(auto: boolean): CompactionPart {
	return { type: "compaction", auto }
}

/**
 * Creates a StepStartPart marking the beginning of an assistant step.
 * @param snapshot - Optional snapshot hash
 * @returns A StepStartPart object
 */
export function createStepStartPart(snapshot?: string): StepStartPart {
	return {
		type: "step-start",
		...(snapshot !== undefined ? { snapshot } : {}),
	}
}

/**
 * Creates a ToolPart in pending state.
 * @param callId - The tool call ID
 * @param tool - The tool name
 * @returns A ToolPart object with state "pending"
 */
export function createToolPart(callId: string, tool: string): ToolPart {
	return { type: "tool", callId, tool, state: "pending" }
}

/**
 * Creates a StepFinishPart marking the end of an assistant step.
 * @param finishReason - The reason the step finished
 * @param usage - Optional token usage information
 * @param cost - Optional cost in dollars
 * @param snapshot - Optional snapshot hash
 * @returns A StepFinishPart object
 */
export function createStepFinishPart(
	finishReason: string,
	usage?: StepFinishPart["usage"],
	cost?: number,
	snapshot?: string,
): StepFinishPart {
	return {
		type: "step-finish",
		finishReason,
		...(usage !== undefined ? { usage } : {}),
		...(cost !== undefined ? { cost } : {}),
		...(snapshot !== undefined ? { snapshot } : {}),
	}
}

/**
 * Creates an EditPart referencing file edits.
 * @param hash - The edit hash
 * @param files - Array of affected file paths
 * @returns An EditPart object
 */
export function createEditPart(hash: string, files: string[]): EditPart {
	return { type: "edit", hash, files }
}

/**
 * Creates a ReasoningPart for model reasoning content.
 * @param text - The reasoning text
 * @returns A ReasoningPart object
 */
export function createReasoningPart(text: string): ReasoningPart {
	return { type: "reasoning", text }
}

/**
 * Creates a RetryPart recording a retry attempt.
 * @param error - The error that triggered the retry
 * @param attempt - The attempt number
 * @param timestamp - The timestamp of the retry
 * @returns A RetryPart object
 */
export function createRetryPart(error: string, attempt: number, timestamp: number): RetryPart {
	return { type: "retry", error, attempt, timestamp }
}

/**
 * Creates a SnapshotPart referencing a VCS snapshot.
 * @param commitHash - The commit hash
 * @returns A SnapshotPart object
 */
export function createSnapshotPart(commitHash: string): SnapshotPart {
	return { type: "snapshot", commitHash }
}
