import { describe, expect, it } from "vitest"
import { filterCompacted } from "../../core/message/compact"
import { toModelMessages } from "../../core/message/convert"
import {
	createCompactionPart,
	createEditPart,
	createFilePart,
	createReasoningPart,
	createRetryPart,
	createSnapshotPart,
	createStepFinishPart,
	createStepStartPart,
	createSubtaskPart,
	createTextPart,
	createToolPart,
} from "../../core/message/parts"
import type { MessageWithParts } from "../../core/schema/message"

// ─── Helper ───────────────────────────────────────────────────

function makeMessage(
	overrides: Partial<MessageWithParts> & Pick<MessageWithParts, "role" | "parts">,
): MessageWithParts {
	return {
		id: overrides.id ?? "msg-" + Math.random().toString(36).slice(2),
		sessionId: "sess1",
		role: overrides.role,
		metadata: overrides.metadata,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		parts: overrides.parts,
	}
}

// ─── toModelMessages ──────────────────────────────────────────

describe("toModelMessages", () => {
	it("converts user message with TextPart to CoreUserMessage", () => {
		const messages: MessageWithParts[] = [
			makeMessage({ role: "user", parts: [{ type: "text", text: "hello" }] }),
		]
		const result = toModelMessages(messages)
		expect(result).toHaveLength(1)
		expect(result[0].role).toBe("user")
		expect(result[0].content).toEqual([{ type: "text", text: "hello" }])
	})

	it("converts user message with FilePart to text placeholder", () => {
		const messages: MessageWithParts[] = [
			makeMessage({
				role: "user",
				parts: [{ type: "file", path: "/foo.txt", mimeType: "text/plain", content: "data" }],
			}),
		]
		const result = toModelMessages(messages)
		expect(result).toHaveLength(1)
		expect(result[0].role).toBe("user")
		const content = result[0].content as Array<{ type: string; text: string }>
		expect(content[0].text).toContain("[File: /foo.txt (text/plain)]")
	})

	it("converts user message with CompactionPart to summary text", () => {
		const messages: MessageWithParts[] = [
			makeMessage({ role: "user", parts: [{ type: "compaction", auto: true }] }),
		]
		const result = toModelMessages(messages)
		expect(result).toHaveLength(1)
		const content = result[0].content as Array<{ type: string; text: string }>
		expect(content[0].text).toContain("summary of what we have done")
	})

	it("converts user message with SubtaskPart to text", () => {
		const messages: MessageWithParts[] = [
			makeMessage({
				role: "user",
				parts: [{ type: "subtask", sessionId: "s1", description: "fix bug", agent: "build" }],
			}),
		]
		const result = toModelMessages(messages)
		expect(result).toHaveLength(1)
		const content = result[0].content as Array<{ type: string; text: string }>
		expect(content[0].text).toContain("Tool executed by user: build")
		expect(content[0].text).toContain("fix bug")
	})

	it("converts assistant message with TextPart + ToolPart to CoreAssistantMessage + CoreToolMessage", () => {
		const messages: MessageWithParts[] = [
			makeMessage({
				role: "assistant",
				parts: [
					{ type: "text", text: "Let me check" },
					{
						type: "tool",
						callId: "call1",
						tool: "bash",
						state: "completed",
						input: { command: "ls" },
						output: "file.txt",
					},
				],
			}),
		]
		const result = toModelMessages(messages)
		expect(result).toHaveLength(2)
		expect(result[0].role).toBe("assistant")
		expect(result[1].role).toBe("tool")

		const assistantContent = result[0].content as Array<any>
		expect(assistantContent).toHaveLength(2)
		expect(assistantContent[0]).toEqual({ type: "text", text: "Let me check" })
		expect(assistantContent[1].type).toBe("tool-call")
		expect(assistantContent[1].toolCallId).toBe("call1")

		const toolContent = result[1].content as Array<any>
		expect(toolContent[0].type).toBe("tool-result")
		expect(toolContent[0].output).toEqual({ type: "text", value: "file.txt" })
	})

	it("renders compacted tool output as cleared message", () => {
		const messages: MessageWithParts[] = [
			makeMessage({
				role: "assistant",
				parts: [
					{
						type: "tool",
						callId: "call1",
						tool: "bash",
						state: "completed",
						input: { command: "ls" },
						output: "long output...",
						time: { start: 100, end: 200, compacted: true },
					},
				],
			}),
		]
		const result = toModelMessages(messages)
		const toolContent = result[1].content as Array<any>
		expect(toolContent[0].output).toEqual({
			type: "text",
			value: "[Old tool result content cleared]",
		})
	})

	it("returns empty array for empty messages", () => {
		expect(toModelMessages([])).toEqual([])
	})

	it("skips user messages with no convertible parts", () => {
		const messages: MessageWithParts[] = [
			makeMessage({
				role: "user",
				parts: [],
			}),
		]
		expect(toModelMessages(messages)).toEqual([])
	})

	it("skips assistant metadata parts (step-start, step-finish, edit, retry, snapshot)", () => {
		const messages: MessageWithParts[] = [
			makeMessage({
				role: "assistant",
				parts: [
					{ type: "step-start" },
					{ type: "text", text: "hello" },
					{ type: "step-finish", finishReason: "stop" },
					{ type: "edit", hash: "h", files: [] },
					{ type: "retry", error: "e", attempt: 1, timestamp: 0 },
					{ type: "snapshot", commitHash: "abc" },
				],
			}),
		]
		const result = toModelMessages(messages)
		expect(result).toHaveLength(1)
		expect(result[0].role).toBe("assistant")
		const content = result[0].content as Array<any>
		expect(content).toHaveLength(1)
		expect(content[0].text).toBe("hello")
	})

	it("uses error as tool result when output is missing", () => {
		const messages: MessageWithParts[] = [
			makeMessage({
				role: "assistant",
				parts: [
					{
						type: "tool",
						callId: "call1",
						tool: "bash",
						state: "error",
						input: {},
						error: "command failed",
					},
				],
			}),
		]
		const result = toModelMessages(messages)
		const toolContent = result[1].content as Array<any>
		expect(toolContent[0].output).toEqual({ type: "text", value: "command failed" })
	})
})

// ─── filterCompacted ──────────────────────────────────────────

describe("filterCompacted", () => {
	it("returns all messages when no compaction exists", () => {
		const messages: MessageWithParts[] = [
			makeMessage({ role: "user", parts: [{ type: "text", text: "hi" }] }),
			makeMessage({ role: "assistant", parts: [{ type: "text", text: "hello" }] }),
		]
		const result = filterCompacted(messages)
		expect(result).toHaveLength(2)
	})

	it("returns empty array for empty input", () => {
		expect(filterCompacted([])).toEqual([])
	})

	it("returns messages from compaction boundary forward with single compaction", () => {
		const boundaryId = "boundary-msg"
		const messages: MessageWithParts[] = [
			makeMessage({ role: "user", parts: [{ type: "text", text: "old message" }] }),
			makeMessage({ role: "assistant", parts: [{ type: "text", text: "old reply" }] }),
			makeMessage({
				id: boundaryId,
				role: "user",
				parts: [{ type: "compaction", auto: true }],
			}),
			makeMessage({
				role: "assistant",
				metadata: { summary: true, finish: "stop" },
				parts: [{ type: "text", text: "summary" }],
			}),
			makeMessage({ role: "user", parts: [{ type: "text", text: "new message" }] }),
		]

		// The algorithm walks backwards: finds the summary assistant message (index 3),
		// then records the preceding user (index 2) in completed set,
		// then finds that user has compaction part, breaks at index 2.
		const result = filterCompacted(messages)
		expect(result).toHaveLength(3) // boundary msg + summary + new message
		expect(result[0].id).toBe(boundaryId)
	})

	it("returns most recent post-boundary with multiple compactions", () => {
		const boundary1Id = "boundary1"
		const boundary2Id = "boundary2"
		const messages: MessageWithParts[] = [
			// First compaction boundary
			makeMessage({
				id: boundary1Id,
				role: "user",
				parts: [{ type: "compaction", auto: true }],
			}),
			makeMessage({
				role: "assistant",
				metadata: { summary: true, finish: "stop" },
				parts: [{ type: "text", text: "summary 1" }],
			}),
			// Some messages
			makeMessage({ role: "user", parts: [{ type: "text", text: "mid message" }] }),
			// Second compaction boundary
			makeMessage({
				id: boundary2Id,
				role: "user",
				parts: [{ type: "compaction", auto: true }],
			}),
			makeMessage({
				role: "assistant",
				metadata: { summary: true, finish: "stop" },
				parts: [{ type: "text", text: "summary 2" }],
			}),
			makeMessage({ role: "user", parts: [{ type: "text", text: "latest" }] }),
		]

		const result = filterCompacted(messages)
		// Should break at the second (most recent) boundary
		expect(result[0].id).toBe(boundary2Id)
		expect(result).toHaveLength(3)
	})

	it("returns all messages when summary is incomplete (no finish)", () => {
		const messages: MessageWithParts[] = [
			makeMessage({
				role: "user",
				parts: [{ type: "compaction", auto: true }],
			}),
			makeMessage({
				role: "assistant",
				metadata: { summary: true },
				parts: [{ type: "text", text: "incomplete summary" }],
			}),
			makeMessage({ role: "user", parts: [{ type: "text", text: "next" }] }),
		]

		const result = filterCompacted(messages)
		// Since finish is not set, the compaction boundary is not completed
		expect(result).toHaveLength(3)
	})
})

// ─── Part factory functions ───────────────────────────────────

describe("Part factory functions", () => {
	it("createTextPart returns correct shape", () => {
		const part = createTextPart("hello")
		expect(part).toEqual({ type: "text", text: "hello" })
	})

	it("createTextPart with options", () => {
		const part = createTextPart("hello", { synthetic: true, ignored: true })
		expect(part.synthetic).toBe(true)
		expect(part.ignored).toBe(true)
	})

	it("createFilePart returns correct shape", () => {
		const part = createFilePart("/foo.txt", "text/plain", "content")
		expect(part).toEqual({
			type: "file",
			path: "/foo.txt",
			mimeType: "text/plain",
			content: "content",
		})
	})

	it("createSubtaskPart returns correct shape", () => {
		const part = createSubtaskPart("s1", "do stuff", "build")
		expect(part).toEqual({
			type: "subtask",
			sessionId: "s1",
			description: "do stuff",
			agent: "build",
		})
	})

	it("createSubtaskPart with command", () => {
		const part = createSubtaskPart("s1", "do stuff", "build", "ls -la")
		expect(part.command).toBe("ls -la")
	})

	it("createCompactionPart returns correct shape", () => {
		const part = createCompactionPart(true)
		expect(part).toEqual({ type: "compaction", auto: true })
	})

	it("createStepStartPart without snapshot", () => {
		const part = createStepStartPart()
		expect(part).toEqual({ type: "step-start" })
		expect(part).not.toHaveProperty("snapshot")
	})

	it("createStepStartPart with snapshot", () => {
		const part = createStepStartPart("abc")
		expect(part.snapshot).toBe("abc")
	})

	it("createToolPart returns pending state", () => {
		const part = createToolPart("call1", "bash")
		expect(part).toEqual({ type: "tool", callId: "call1", tool: "bash", state: "pending" })
	})

	it("createStepFinishPart with all args", () => {
		const part = createStepFinishPart("stop", { input: 100, output: 50 }, 0.05, "snap")
		expect(part.finishReason).toBe("stop")
		expect(part.usage).toEqual({ input: 100, output: 50 })
		expect(part.cost).toBe(0.05)
		expect(part.snapshot).toBe("snap")
	})

	it("createStepFinishPart minimal", () => {
		const part = createStepFinishPart("tool-calls")
		expect(part).toEqual({ type: "step-finish", finishReason: "tool-calls" })
	})

	it("createEditPart returns correct shape", () => {
		const part = createEditPart("h1", ["/a.ts"])
		expect(part).toEqual({ type: "edit", hash: "h1", files: ["/a.ts"] })
	})

	it("createReasoningPart returns correct shape", () => {
		const part = createReasoningPart("thinking...")
		expect(part).toEqual({ type: "reasoning", text: "thinking..." })
	})

	it("createRetryPart returns correct shape", () => {
		const part = createRetryPart("rate limit", 2, 1234567890)
		expect(part).toEqual({
			type: "retry",
			error: "rate limit",
			attempt: 2,
			timestamp: 1234567890,
		})
	})

	it("createSnapshotPart returns correct shape", () => {
		const part = createSnapshotPart("deadbeef")
		expect(part).toEqual({ type: "snapshot", commitHash: "deadbeef" })
	})
})
