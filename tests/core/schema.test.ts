import { describe, it, expect } from "vitest"
import {
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
	PartSchema,
	UserPartSchema,
	AssistantPartSchema,
	MessageSchema,
	MessageWithPartsSchema,
	SessionSchema,
	SessionStatusSchema,
	ProjectSchema,
	GlobalEventSchema,
	PermissionRequestSchema,
	PermissionRuleSchema,
	PermissionRulesetSchema,
} from "@core/schema"

// ─── Part Schemas ─────────────────────────────────────────────

describe("PartSchema", () => {
	describe("TextPartSchema", () => {
		it("parses a valid text part", () => {
			const result = TextPartSchema.parse({ type: "text", text: "hello" })
			expect(result).toEqual({ type: "text", text: "hello" })
		})

		it("parses with optional synthetic and ignored flags", () => {
			const result = TextPartSchema.parse({
				type: "text",
				text: "hello",
				synthetic: true,
				ignored: false,
			})
			expect(result.synthetic).toBe(true)
			expect(result.ignored).toBe(false)
		})

		it("rejects missing text field", () => {
			expect(() => TextPartSchema.parse({ type: "text" })).toThrow()
		})
	})

	describe("FilePartSchema", () => {
		it("parses a valid file part", () => {
			const result = FilePartSchema.parse({
				type: "file",
				path: "/foo/bar.txt",
				mimeType: "text/plain",
				content: "abc",
			})
			expect(result.path).toBe("/foo/bar.txt")
			expect(result.mimeType).toBe("text/plain")
		})

		it("rejects missing path", () => {
			expect(() =>
				FilePartSchema.parse({ type: "file", mimeType: "text/plain", content: "abc" }),
			).toThrow()
		})
	})

	describe("SubtaskPartSchema", () => {
		it("parses a valid subtask part", () => {
			const result = SubtaskPartSchema.parse({
				type: "subtask",
				sessionId: "s1",
				description: "do stuff",
				agent: "build",
			})
			expect(result.agent).toBe("build")
		})

		it("parses with optional command", () => {
			const result = SubtaskPartSchema.parse({
				type: "subtask",
				sessionId: "s1",
				description: "do stuff",
				agent: "build",
				command: "ls",
			})
			expect(result.command).toBe("ls")
		})
	})

	describe("CompactionPartSchema", () => {
		it("parses a valid compaction part", () => {
			const result = CompactionPartSchema.parse({ type: "compaction", auto: true })
			expect(result.auto).toBe(true)
		})

		it("rejects missing auto field", () => {
			expect(() => CompactionPartSchema.parse({ type: "compaction" })).toThrow()
		})
	})

	describe("StepStartPartSchema", () => {
		it("parses without snapshot", () => {
			const result = StepStartPartSchema.parse({ type: "step-start" })
			expect(result.type).toBe("step-start")
		})

		it("parses with snapshot", () => {
			const result = StepStartPartSchema.parse({ type: "step-start", snapshot: "abc123" })
			expect(result.snapshot).toBe("abc123")
		})
	})

	describe("ReasoningPartSchema", () => {
		it("parses a valid reasoning part", () => {
			const result = ReasoningPartSchema.parse({ type: "reasoning", text: "thinking..." })
			expect(result.text).toBe("thinking...")
		})

		it("parses with time and providerMetadata", () => {
			const result = ReasoningPartSchema.parse({
				type: "reasoning",
				text: "thinking...",
				time: { start: 1000, end: 2000 },
				providerMetadata: { key: "value" },
			})
			expect(result.time).toEqual({ start: 1000, end: 2000 })
		})
	})

	describe("ToolPartSchema", () => {
		it("parses a valid tool part with all fields", () => {
			const result = ToolPartSchema.parse({
				type: "tool",
				callId: "c1",
				tool: "bash",
				state: "completed",
				input: { command: "ls" },
				output: "file.txt",
				time: { start: 100, end: 200, compacted: false },
			})
			expect(result.tool).toBe("bash")
			expect(result.state).toBe("completed")
		})

		it("parses minimal tool part", () => {
			const result = ToolPartSchema.parse({
				type: "tool",
				callId: "c1",
				tool: "read",
				state: "pending",
			})
			expect(result.input).toBeUndefined()
			expect(result.output).toBeUndefined()
		})

		it("rejects invalid state", () => {
			expect(() =>
				ToolPartSchema.parse({
					type: "tool",
					callId: "c1",
					tool: "read",
					state: "invalid",
				}),
			).toThrow()
		})
	})

	describe("StepFinishPartSchema", () => {
		it("parses with all fields", () => {
			const result = StepFinishPartSchema.parse({
				type: "step-finish",
				finishReason: "stop",
				usage: { input: 100, output: 50, reasoning: 10, cacheRead: 20, cacheWrite: 5 },
				cost: 0.05,
				snapshot: "abc",
				sources: [{ url: "https://example.com", title: "Example" }],
			})
			expect(result.finishReason).toBe("stop")
			expect(result.usage?.input).toBe(100)
			expect(result.sources).toHaveLength(1)
		})

		it("parses minimal step-finish", () => {
			const result = StepFinishPartSchema.parse({
				type: "step-finish",
				finishReason: "tool-calls",
			})
			expect(result.usage).toBeUndefined()
		})
	})

	describe("EditPartSchema", () => {
		it("parses a valid edit part", () => {
			const result = EditPartSchema.parse({
				type: "edit",
				hash: "abc",
				files: ["/a.ts", "/b.ts"],
			})
			expect(result.files).toHaveLength(2)
		})
	})

	describe("RetryPartSchema", () => {
		it("parses a valid retry part", () => {
			const result = RetryPartSchema.parse({
				type: "retry",
				error: "rate limit",
				attempt: 2,
				timestamp: 1234567890,
			})
			expect(result.attempt).toBe(2)
		})
	})

	describe("SnapshotPartSchema", () => {
		it("parses a valid snapshot part", () => {
			const result = SnapshotPartSchema.parse({
				type: "snapshot",
				commitHash: "deadbeef",
			})
			expect(result.commitHash).toBe("deadbeef")
		})
	})

	describe("discriminated unions", () => {
		it("PartSchema accepts all 11 part types", () => {
			const parts = [
				{ type: "text", text: "hi" },
				{ type: "file", path: "/f", mimeType: "text/plain", content: "c" },
				{ type: "subtask", sessionId: "s", description: "d", agent: "a" },
				{ type: "compaction", auto: false },
				{ type: "step-start" },
				{ type: "reasoning", text: "r" },
				{ type: "tool", callId: "c", tool: "t", state: "pending" },
				{ type: "step-finish", finishReason: "stop" },
				{ type: "edit", hash: "h", files: [] },
				{ type: "retry", error: "e", attempt: 1, timestamp: 0 },
				{ type: "snapshot", commitHash: "h" },
			]
			for (const part of parts) {
				expect(() => PartSchema.parse(part)).not.toThrow()
			}
		})

		it("PartSchema rejects unknown type", () => {
			expect(() => PartSchema.parse({ type: "unknown" })).toThrow()
		})

		it("UserPartSchema accepts text, file, subtask, compaction", () => {
			expect(() => UserPartSchema.parse({ type: "text", text: "hi" })).not.toThrow()
			expect(() =>
				UserPartSchema.parse({
					type: "file",
					path: "/f",
					mimeType: "m",
					content: "c",
				}),
			).not.toThrow()
			expect(() =>
				UserPartSchema.parse({
					type: "subtask",
					sessionId: "s",
					description: "d",
					agent: "a",
				}),
			).not.toThrow()
			expect(() =>
				UserPartSchema.parse({ type: "compaction", auto: true }),
			).not.toThrow()
		})

		it("UserPartSchema rejects assistant-only types", () => {
			expect(() =>
				UserPartSchema.parse({ type: "tool", callId: "c", tool: "t", state: "pending" }),
			).toThrow()
		})

		it("AssistantPartSchema accepts text, step-start, reasoning, tool, step-finish, edit, retry, snapshot", () => {
			expect(() => AssistantPartSchema.parse({ type: "text", text: "hi" })).not.toThrow()
			expect(() => AssistantPartSchema.parse({ type: "step-start" })).not.toThrow()
			expect(() =>
				AssistantPartSchema.parse({ type: "reasoning", text: "r" }),
			).not.toThrow()
			expect(() =>
				AssistantPartSchema.parse({
					type: "tool",
					callId: "c",
					tool: "t",
					state: "running",
				}),
			).not.toThrow()
		})
	})
})

// ─── Message Schema ───────────────────────────────────────────

describe("MessageSchema", () => {
	const validMessage = {
		id: "msg1",
		sessionId: "s1",
		role: "user" as const,
		createdAt: 1000,
		updatedAt: 2000,
	}

	it("parses a valid user message", () => {
		const result = MessageSchema.parse(validMessage)
		expect(result.role).toBe("user")
	})

	it("parses a valid assistant message", () => {
		const result = MessageSchema.parse({ ...validMessage, role: "assistant" })
		expect(result.role).toBe("assistant")
	})

	it("parses with user metadata", () => {
		const result = MessageSchema.parse({
			...validMessage,
			metadata: { agent: "build", system: "sys" },
		})
		expect(result.metadata).toBeDefined()
	})

	it("parses with assistant metadata", () => {
		const result = MessageSchema.parse({
			...validMessage,
			role: "assistant",
			metadata: { modelId: "claude-sonnet-4-5", finish: "stop" },
		})
		expect(result.metadata).toBeDefined()
	})

	it("rejects invalid role", () => {
		expect(() => MessageSchema.parse({ ...validMessage, role: "system" })).toThrow()
	})

	it("rejects missing required fields", () => {
		expect(() => MessageSchema.parse({ id: "msg1" })).toThrow()
	})
})

describe("MessageWithPartsSchema", () => {
	it("parses a message with parts array", () => {
		const result = MessageWithPartsSchema.parse({
			id: "msg1",
			sessionId: "s1",
			role: "user",
			createdAt: 1000,
			updatedAt: 2000,
			parts: [{ type: "text", text: "hello" }],
		})
		expect(result.parts).toHaveLength(1)
	})

	it("parses a message with empty parts", () => {
		const result = MessageWithPartsSchema.parse({
			id: "msg1",
			sessionId: "s1",
			role: "assistant",
			createdAt: 1000,
			updatedAt: 2000,
			parts: [],
		})
		expect(result.parts).toHaveLength(0)
	})
})

// ─── Session Schema ───────────────────────────────────────────

describe("SessionSchema", () => {
	it("parses a valid session", () => {
		const result = SessionSchema.parse({
			id: "sess1",
			projectId: "proj1",
			directory: "/workspace",
			title: "My Session",
			permission: { mode: "default", rules: [] },
			compactedAt: null,
			archivedAt: null,
			createdAt: 1000,
			updatedAt: 2000,
		})
		expect(result.id).toBe("sess1")
		expect(result.title).toBe("My Session")
	})

	it("parses with nullable fields set to null", () => {
		const result = SessionSchema.parse({
			id: "sess1",
			projectId: "proj1",
			directory: "/workspace",
			title: null,
			permission: null,
			compactedAt: null,
			archivedAt: null,
			createdAt: 1000,
			updatedAt: 2000,
		})
		expect(result.title).toBeNull()
		expect(result.permission).toBeNull()
	})

	it("rejects missing directory", () => {
		expect(() =>
			SessionSchema.parse({
				id: "sess1",
				projectId: "proj1",
				title: null,
				permission: null,
				compactedAt: null,
				archivedAt: null,
				createdAt: 1000,
				updatedAt: 2000,
			}),
		).toThrow()
	})
})

describe("SessionStatusSchema", () => {
	it("parses all valid statuses", () => {
		const statuses = ["idle", "busy", "retry", "awaiting-permission", "awaiting-question"]
		for (const status of statuses) {
			expect(SessionStatusSchema.parse(status)).toBe(status)
		}
	})

	it("rejects invalid status", () => {
		expect(() => SessionStatusSchema.parse("running")).toThrow()
	})
})

// ─── Project Schema ───────────────────────────────────────────

describe("ProjectSchema", () => {
	it("parses a valid project", () => {
		const result = ProjectSchema.parse({
			id: "proj1",
			name: "My Project",
			directory: "/workspace",
			worktree: null,
			vcs: "git",
			createdAt: 1000,
			updatedAt: 2000,
		})
		expect(result.name).toBe("My Project")
		expect(result.vcs).toBe("git")
	})

	it("parses with null optional fields", () => {
		const result = ProjectSchema.parse({
			id: "proj1",
			name: "My Project",
			directory: "/workspace",
			worktree: null,
			vcs: null,
			createdAt: 1000,
			updatedAt: 2000,
		})
		expect(result.worktree).toBeNull()
		expect(result.vcs).toBeNull()
	})

	it("rejects invalid vcs value", () => {
		expect(() =>
			ProjectSchema.parse({
				id: "proj1",
				name: "My Project",
				directory: "/workspace",
				worktree: null,
				vcs: "svn",
				createdAt: 1000,
				updatedAt: 2000,
			}),
		).toThrow()
	})
})

// ─── GlobalEvent Schema ───────────────────────────────────────

describe("GlobalEventSchema", () => {
	it("parses session:status event", () => {
		const result = GlobalEventSchema.parse({
			type: "session:status",
			directory: "/workspace",
			sessionId: "s1",
			status: "busy",
		})
		expect(result.type).toBe("session:status")
	})

	it("parses session:update event", () => {
		const result = GlobalEventSchema.parse({
			type: "session:update",
			directory: "/workspace",
			sessionId: "s1",
			session: {
				id: "s1",
				projectId: "p1",
				directory: "/workspace",
				title: null,
				permission: null,
				compactedAt: null,
				archivedAt: null,
				createdAt: 1000,
				updatedAt: 2000,
			},
		})
		expect(result.type).toBe("session:update")
	})

	it("parses message:create event", () => {
		const result = GlobalEventSchema.parse({
			type: "message:create",
			directory: "/workspace",
			sessionId: "s1",
			message: {
				id: "m1",
				sessionId: "s1",
				role: "user",
				createdAt: 1000,
				updatedAt: 2000,
				parts: [],
			},
		})
		expect(result.type).toBe("message:create")
	})

	it("parses part:upsert event", () => {
		const result = GlobalEventSchema.parse({
			type: "part:upsert",
			directory: "/workspace",
			sessionId: "s1",
			messageId: "m1",
			part: { type: "text", text: "hello" },
		})
		expect(result.type).toBe("part:upsert")
	})

	it("parses part:delta event", () => {
		const result = GlobalEventSchema.parse({
			type: "part:delta",
			directory: "/workspace",
			sessionId: "s1",
			messageId: "m1",
			partId: "p1",
			delta: "chunk",
		})
		expect(result.type).toBe("part:delta")
	})

	it("parses permission:request event", () => {
		const result = GlobalEventSchema.parse({
			type: "permission:request",
			directory: "/workspace",
			sessionId: "s1",
			request: {
				id: "req1",
				sessionId: "s1",
				tool: "bash",
				input: { command: "rm -rf /" },
				type: "tool",
			},
		})
		expect(result.type).toBe("permission:request")
	})

	it("parses question:request event", () => {
		const result = GlobalEventSchema.parse({
			type: "question:request",
			directory: "/workspace",
			sessionId: "s1",
			question: {
				id: "q1",
				text: "What should I do?",
				sessionId: "s1",
			},
		})
		expect(result.type).toBe("question:request")
	})

	it("parses heartbeat event", () => {
		const result = GlobalEventSchema.parse({ type: "heartbeat" })
		expect(result.type).toBe("heartbeat")
	})

	it("rejects unknown event type", () => {
		expect(() =>
			GlobalEventSchema.parse({ type: "unknown:event", directory: "/workspace" }),
		).toThrow()
	})
})

// ─── Permission Schema ───────────────────────────────────────

describe("PermissionRequestSchema", () => {
	it("parses a valid tool permission request", () => {
		const result = PermissionRequestSchema.parse({
			id: "req1",
			sessionId: "s1",
			tool: "bash",
			input: { command: "ls" },
			type: "tool",
		})
		expect(result.tool).toBe("bash")
		expect(result.type).toBe("tool")
	})

	it("parses a doom_loop permission request", () => {
		const result = PermissionRequestSchema.parse({
			id: "req1",
			sessionId: "s1",
			tool: "bash",
			input: { command: "ls" },
			reason: "Detected doom loop",
			type: "doom_loop",
		})
		expect(result.type).toBe("doom_loop")
		expect(result.reason).toBe("Detected doom loop")
	})

	it("rejects invalid type", () => {
		expect(() =>
			PermissionRequestSchema.parse({
				id: "req1",
				sessionId: "s1",
				tool: "bash",
				input: {},
				type: "invalid",
			}),
		).toThrow()
	})
})

describe("PermissionRulesetSchema", () => {
	it("parses a valid ruleset", () => {
		const result = PermissionRulesetSchema.parse({
			mode: "default",
			rules: [{ tool: "bash", allow: false }],
		})
		expect(result.mode).toBe("default")
		expect(result.rules).toHaveLength(1)
	})

	it("parses all valid modes", () => {
		for (const mode of ["default", "ask-always", "allow-all"]) {
			expect(() =>
				PermissionRulesetSchema.parse({ mode, rules: [] }),
			).not.toThrow()
		}
	})

	it("parses rule with prefix", () => {
		const result = PermissionRuleSchema.parse({
			tool: "bash",
			allow: true,
			prefix: "git ",
		})
		expect(result.prefix).toBe("git ")
	})
})
