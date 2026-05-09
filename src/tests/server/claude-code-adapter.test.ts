import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	type AdapterEmission,
	type PartEmitter,
	type SdkMessageLike,
	createClaudeCodeAdapter,
} from "../../server/loop/claude-code/adapter"

/**
 * Unit tests for the Claude Code SDK → Loop part adapter.
 *
 * The adapter takes an injected `PartEmitter` so these tests can spy on
 * everything that lands in the DB/bus without having to boot a workspace.
 */

function createCapturingEmitter() {
	const calls: Array<
		| { kind: "upsert"; part: { id: string; type: string; data: Record<string, unknown> } }
		| { kind: "delta"; partId: string; delta: string; partType: "text" | "reasoning" }
	> = []
	const emitter: PartEmitter = {
		upsertPart: (part) => {
			calls.push({
				kind: "upsert",
				part: { id: part.id, type: part.type, data: part.data },
			})
		},
		emitDelta: (args) => {
			calls.push({ kind: "delta", ...args })
		},
	}
	return { emitter, calls }
}

function upsertsOfType(calls: ReturnType<typeof createCapturingEmitter>["calls"], type: string) {
	return calls.flatMap((c) => (c.kind === "upsert" && c.part.type === type ? [c.part] : []))
}

function deltas(calls: ReturnType<typeof createCapturingEmitter>["calls"]) {
	return calls.flatMap((c) => (c.kind === "delta" ? [c] : []))
}

function sdkMsg(partial: Partial<SdkMessageLike> & { type: string }): SdkMessageLike {
	return partial
}

describe("createClaudeCodeAdapter", () => {
	let sessionIdCallback: ReturnType<typeof vi.fn>
	let compactBoundaryCallback: ReturnType<typeof vi.fn>
	let authFailureCallback: ReturnType<typeof vi.fn>

	beforeEach(() => {
		sessionIdCallback = vi.fn()
		compactBoundaryCallback = vi.fn()
		authFailureCallback = vi.fn()
	})

	function makeAdapter() {
		const { emitter, calls } = createCapturingEmitter()
		const adapter = createClaudeCodeAdapter({
			sessionId: "sess-1",
			messageId: "msg-1",
			emitter,
			onSessionId: sessionIdCallback,
			onCompactBoundary: compactBoundaryCallback,
			onAuthFailure: authFailureCallback,
		})
		return { adapter, calls }
	}

	it("emits a step-start on system/init", () => {
		const { adapter, calls } = makeAdapter()
		adapter.beginTurn("pre-hash-abc")

		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "init",
				session_id: "sdk-sess-1",
				model: "claude-sonnet-4-5",
				cwd: "/tmp",
				tools: [],
				permissionMode: "default",
			}),
		)

		const steps = upsertsOfType(calls, "step-start")
		expect(steps).toHaveLength(1)
		expect(steps[0].data).toMatchObject({ type: "step-start", snapshot: "pre-hash-abc" })
		expect(sessionIdCallback).toHaveBeenCalledWith("sdk-sess-1")
	})

	it("streams text deltas and flushes a text part on block stop", () => {
		const { adapter, calls } = makeAdapter()

		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_start",
					index: 0,
					content_block: { type: "text", text: "" },
				},
			}),
		)

		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "Hello, " },
				},
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "world!" },
				},
			}),
		)

		// Delta events should reach the bus immediately with no DB write yet.
		const deltaEvents = deltas(calls)
		expect(deltaEvents).toHaveLength(2)
		expect(deltaEvents[0]).toMatchObject({ partType: "text", delta: "Hello, " })
		expect(deltaEvents[1]).toMatchObject({ partType: "text", delta: "world!" })
		expect(upsertsOfType(calls, "text")).toHaveLength(0)

		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: { type: "content_block_stop", index: 0 },
			}),
		)

		const textParts = upsertsOfType(calls, "text")
		expect(textParts).toHaveLength(1)
		expect(textParts[0].data).toMatchObject({ type: "text", text: "Hello, world!" })
	})

	it("accumulates thinking deltas into a reasoning part", () => {
		const { adapter, calls } = makeAdapter()

		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_start",
					index: 1,
					content_block: { type: "thinking", thinking: "", signature: "" },
				},
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_delta",
					index: 1,
					delta: { type: "thinking_delta", thinking: "Let me think..." },
				},
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: { type: "content_block_stop", index: 1 },
			}),
		)

		const reasoningParts = upsertsOfType(calls, "reasoning")
		expect(reasoningParts).toHaveLength(1)
		expect(reasoningParts[0].data).toMatchObject({
			type: "reasoning",
			text: "Let me think...",
		})
		const data = reasoningParts[0].data as { time: { start: number; end: number } }
		expect(typeof data.time.start).toBe("number")
		expect(typeof data.time.end).toBe("number")
	})

	it("tracks tool calls through pending → running → completed", () => {
		const { adapter, calls } = makeAdapter()

		// SDK opens a tool_use block.
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_start",
					index: 2,
					content_block: {
						type: "tool_use",
						id: "tool-use-1",
						name: "Read",
						input: {},
					},
				},
			}),
		)

		const pendingBefore = upsertsOfType(calls, "tool")
		expect(pendingBefore).toHaveLength(1)
		expect(pendingBefore[0].data).toMatchObject({
			state: "pending",
			callId: "tool-use-1",
			tool: "Read",
		})

		// Streaming input JSON as it becomes valid.
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_delta",
					index: 2,
					delta: {
						type: "input_json_delta",
						partial_json: '{"path":"/tmp/foo',
					},
				},
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_delta",
					index: 2,
					delta: {
						type: "input_json_delta",
						partial_json: '.txt"}',
					},
				},
			}),
		)

		// Once valid JSON, we should re-upsert with the parsed input.
		const pendingAfter = upsertsOfType(calls, "tool").filter(
			(p) => (p.data as any).state === "pending" && (p.data as any).input,
		)
		expect(pendingAfter.length).toBeGreaterThan(0)
		expect(pendingAfter.at(-1)?.data).toMatchObject({
			state: "pending",
			input: { path: "/tmp/foo.txt" },
		})

		// Close the block → transition to running.
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: { type: "content_block_stop", index: 2 },
			}),
		)
		const running = upsertsOfType(calls, "tool").filter((p) => (p.data as any).state === "running")
		expect(running).toHaveLength(1)
		expect(running[0].data).toMatchObject({
			state: "running",
			input: { path: "/tmp/foo.txt" },
		})

		// Tool result arrives on a user message.
		adapter.handle(
			sdkMsg({
				type: "user",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-use-1",
							content: [{ type: "text", text: "file contents here" }],
						},
					],
				},
			}),
		)

		const completed = upsertsOfType(calls, "tool").filter(
			(p) => (p.data as any).state === "completed",
		)
		expect(completed).toHaveLength(1)
		expect(completed[0].data).toMatchObject({
			state: "completed",
			output: "file contents here",
		})
	})

	it("marks a tool as error when tool_result has is_error", () => {
		const { adapter, calls } = makeAdapter()
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_start",
					index: 0,
					content_block: { type: "tool_use", id: "t1", name: "Bash", input: {} },
				},
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: { type: "content_block_stop", index: 0 },
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "user",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "t1",
							is_error: true,
							content: "command not found",
						},
					],
				},
			}),
		)

		const errored = upsertsOfType(calls, "tool").filter((p) => (p.data as any).state === "error")
		expect(errored).toHaveLength(1)
		expect(errored[0].data).toMatchObject({
			state: "error",
			error: "command not found",
		})
	})

	it("handles out-of-order parallel tool calls", () => {
		const { adapter, calls } = makeAdapter()

		// Open two tools.
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_start",
					index: 0,
					content_block: { type: "tool_use", id: "tool-A", name: "Read", input: {} },
				},
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_start",
					index: 1,
					content_block: { type: "tool_use", id: "tool-B", name: "Bash", input: {} },
				},
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: { type: "content_block_stop", index: 0 },
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: { type: "content_block_stop", index: 1 },
			}),
		)

		// Tool B resolves first, then tool A.
		adapter.handle(
			sdkMsg({
				type: "user",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-B",
							content: "B done",
						},
					],
				},
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "user",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tool-A",
							content: "A done",
						},
					],
				},
			}),
		)

		const completedTools = upsertsOfType(calls, "tool").filter(
			(p) => (p.data as any).state === "completed",
		)
		// Both tools resolved.
		const completedByCallId = new Map(
			completedTools.map((p) => [(p.data as any).callId as string, (p.data as any).output]),
		)
		expect(completedByCallId.get("tool-A")).toBe("A done")
		expect(completedByCallId.get("tool-B")).toBe("B done")
	})

	it("marks unresolved tools as errors on finalize (stream ended mid-tool)", () => {
		const { adapter, calls } = makeAdapter()

		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_start",
					index: 0,
					content_block: { type: "tool_use", id: "orphan", name: "Write", input: {} },
				},
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: { type: "content_block_stop", index: 0 },
			}),
		)

		// No tool_result → finalize should flush it as error.
		adapter.finalize({ snapshotHash: "post" })

		const errored = upsertsOfType(calls, "tool").filter((p) => (p.data as any).state === "error")
		expect(errored.length).toBeGreaterThanOrEqual(1)
		expect(errored[0].data).toMatchObject({
			state: "error",
			error: expect.stringContaining("Stream ended"),
		})
	})

	it("emits a compaction part on compact_boundary and invokes the callback", () => {
		const { adapter, calls } = makeAdapter()

		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "compact_boundary",
				compact_metadata: {
					trigger: "auto",
					pre_tokens: 95_000,
					post_tokens: 10_000,
				},
			}),
		)

		const compactionParts = upsertsOfType(calls, "compaction")
		expect(compactionParts).toHaveLength(1)
		expect(compactionParts[0].data).toMatchObject({ type: "compaction", auto: true })

		expect(compactBoundaryCallback).toHaveBeenCalledWith({
			trigger: "auto",
			preTokens: 95_000,
			postTokens: 10_000,
		})
	})

	it("invokes onAuthFailure when auth_status arrives with an error", () => {
		const { adapter } = makeAdapter()
		adapter.handle(
			sdkMsg({
				type: "auth_status",
				isAuthenticating: false,
				output: [],
				error: "Please run `claude login`",
			}),
		)
		expect(authFailureCallback).toHaveBeenCalledWith("Please run `claude login`")
	})

	it("records result payload and emits step-finish in finalize", () => {
		const { adapter, calls } = makeAdapter()

		adapter.handle(
			sdkMsg({
				type: "result",
				subtype: "success",
				duration_ms: 1500,
				num_turns: 2,
				stop_reason: "end_turn",
				total_cost_usd: 0.0042,
				usage: {
					input_tokens: 120,
					output_tokens: 450,
					cache_read_input_tokens: 50,
					cache_creation_input_tokens: 10,
				},
			}),
		)

		const result = adapter.finalize({
			snapshotHash: "post-hash-xyz",
			editFiles: [{ path: "src/foo.ts", additions: 5, deletions: 2, status: "modified" }],
		})

		expect(result.finishReason).toBe("end_turn")
		expect(result.usage).toMatchObject({
			input: 120,
			output: 450,
			cacheRead: 50,
			cacheWrite: 10,
		})
		expect(result.costUsd).toBe(0.0042)
		expect(result.durationMs).toBe(1500)
		expect(result.numTurns).toBe(2)

		const stepFinishes = upsertsOfType(calls, "step-finish")
		expect(stepFinishes).toHaveLength(1)
		expect(stepFinishes[0].data).toMatchObject({
			type: "step-finish",
			finishReason: "end_turn",
			cost: 0.0042,
			snapshot: "post-hash-xyz",
		})

		const editParts = upsertsOfType(calls, "edit")
		expect(editParts).toHaveLength(1)
		expect(editParts[0].data).toMatchObject({
			type: "edit",
			hash: "post-hash-xyz",
			totalAdditions: 5,
			totalDeletions: 2,
		})
	})

	it("finalize flushes a partial text block when the stream aborts mid-block", () => {
		const { adapter, calls } = makeAdapter()
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_start",
					index: 0,
					content_block: { type: "text", text: "" },
				},
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "partial output" },
				},
			}),
		)
		// No content_block_stop — abort path.

		adapter.finalize({})

		const textParts = upsertsOfType(calls, "text")
		expect(textParts).toHaveLength(1)
		expect(textParts[0].data).toMatchObject({ type: "text", text: "partial output" })
	})

	it("picks up stop_reason from message_delta when result never arrives", () => {
		const { adapter } = makeAdapter()

		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "message_delta",
					delta: { stop_reason: "tool_use" },
					usage: {},
				},
			}),
		)

		const result = adapter.finalize({})
		expect(result.finishReason).toBe("tool_use")
	})

	it("survives a malformed SDK message without throwing", () => {
		const { adapter } = makeAdapter()
		expect(() => {
			adapter.handle({ type: "stream_event" } as SdkMessageLike)
			adapter.handle({ type: "result", usage: "not-an-object" } as any)
			adapter.handle(null as any)
			adapter.handle({ type: "user", message: null } as any)
		}).not.toThrow()
	})

	it("does not double-emit step-start on repeated init messages", () => {
		const { adapter, calls } = makeAdapter()
		adapter.beginTurn("pre")
		adapter.handle(
			sdkMsg({ type: "system", subtype: "init", session_id: "s", model: "m", cwd: "/", tools: [] }),
		)
		adapter.handle(
			sdkMsg({ type: "system", subtype: "init", session_id: "s", model: "m", cwd: "/", tools: [] }),
		)
		expect(upsertsOfType(calls, "step-start")).toHaveLength(1)
	})

	it("ignores streamed emissions (does not throw/log) — smoke coverage", () => {
		const { adapter } = makeAdapter()
		// Ensure unused helper type does not dangle — referenced through the
		// capturing emitter structure.
		const _emit: AdapterEmission | undefined = undefined
		expect(_emit).toBeUndefined()
		expect(() => adapter.handle(sdkMsg({ type: "tool_progress" }))).not.toThrow()
	})

	it("renames SDK tool name 'Task' to 'Agent' and surfaces async_launched metadata", () => {
		const { adapter, calls } = makeAdapter()

		// Model emits the legacy "Task" name; adapter normalizes to "Agent".
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "tool_use",
						id: "agent-call-1",
						name: "Task",
						input: {},
					},
				},
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_delta",
					index: 0,
					delta: {
						type: "input_json_delta",
						partial_json:
							'{"description":"Investigate auth","prompt":"Find middleware","subagent_type":"Explore","run_in_background":true}',
					},
				},
			}),
		)
		adapter.handle(
			sdkMsg({ type: "stream_event", event: { type: "content_block_stop", index: 0 } }),
		)

		const pending = upsertsOfType(calls, "tool").filter((p) => (p.data as any).tool === "Agent")
		expect(pending.length).toBeGreaterThan(0)

		// Tool_result arrives with async_launched. State should flip to
		// completed and agentStatus metadata should be surfaced.
		adapter.handle(
			sdkMsg({
				type: "user",
				message: {
					content: [
						{
							type: "tool_result",
							tool_use_id: "agent-call-1",
							is_error: false,
							content: [
								{
									type: "text",
									text: JSON.stringify({
										status: "async_launched",
										agentId: "agent-xyz",
										description: "Investigate auth",
										prompt: "Find middleware",
										outputFile: "/tmp/agent-out.md",
										canReadOutputFile: true,
									}),
								},
							],
						},
					],
				},
			}),
		)

		const finalAgent = upsertsOfType(calls, "tool")
			.filter((p) => (p.data as any).tool === "Agent")
			.at(-1)
		expect(finalAgent?.data).toMatchObject({
			state: "completed",
			tool: "Agent",
			metadata: {
				agentStatus: "async_launched",
				agentId: "agent-xyz",
				outputFile: "/tmp/agent-out.md",
				subagentType: "Explore",
			},
		})
	})

	it("surfaces Write file_path from partial input before content string closes", () => {
		const { adapter, calls } = makeAdapter()

		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_start",
					index: 0,
					content_block: { type: "tool_use", id: "t-write", name: "Write", input: {} },
				},
			}),
		)

		// Large content arrives mid-stream: file_path is already written
		// out, but the content string is not yet closed.
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_delta",
					index: 0,
					delta: {
						type: "input_json_delta",
						partial_json: '{"file_path":"/tmp/out.ts","content":"lorem ipsum dolor',
					},
				},
			}),
		)

		const withInput = upsertsOfType(calls, "tool").filter(
			(p) => (p.data as any).state === "pending" && (p.data as any).input?.file_path,
		)
		expect(withInput.length).toBeGreaterThan(0)
		expect(withInput.at(-1)?.data).toMatchObject({
			state: "pending",
			input: { file_path: "/tmp/out.ts" },
		})
	})

	it("emits a Subagent tool part for task_started + progress + notification", () => {
		const { adapter, calls } = makeAdapter()

		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_started",
				task_id: "bg-1",
				tool_use_id: "agent-call-1",
				description: "Investigate auth flow",
				task_type: "local_agent",
			}),
		)
		const afterStart = upsertsOfType(calls, "tool").filter(
			(p) => (p.data as any).tool === "Subagent",
		)
		expect(afterStart).toHaveLength(1)
		expect(afterStart[0].data).toMatchObject({
			state: "running",
			tool: "Subagent",
			callId: "bg-1",
			input: { description: "Investigate auth flow", task_type: "local_agent" },
		})

		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_progress",
				task_id: "bg-1",
				description: "Investigate auth flow",
				usage: { total_tokens: 1500, tool_uses: 4, duration_ms: 8200 },
				last_tool_name: "Grep",
			}),
		)
		const afterProgress = upsertsOfType(calls, "tool").filter(
			(p) => (p.data as any).tool === "Subagent",
		)
		// Same partId → same entry upserted
		expect(afterProgress.at(-1)?.id).toBe(afterStart[0].id)
		expect((afterProgress.at(-1)?.data as any).metadata).toMatchObject({
			taskId: "bg-1",
			usage: { total_tokens: 1500, tool_uses: 4, duration_ms: 8200 },
			lastToolName: "Grep",
		})

		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_notification",
				task_id: "bg-1",
				status: "completed",
				output_file: "/tmp/out.md",
				summary: "Found 3 handlers",
			}),
		)
		const afterNotify = upsertsOfType(calls, "tool").filter(
			(p) => (p.data as any).tool === "Subagent",
		)
		expect(afterNotify.at(-1)?.id).toBe(afterStart[0].id)
		expect(afterNotify.at(-1)?.data).toMatchObject({
			state: "completed",
			output: "Found 3 handlers",
			metadata: {
				taskId: "bg-1",
				status: "completed",
				outputFile: "/tmp/out.md",
				summary: "Found 3 handlers",
			},
		})
	})

	it("fires onTaskStarted / onTaskFinished callbacks across the lifecycle", () => {
		const { emitter } = createCapturingEmitter()
		const started = vi.fn()
		const finished = vi.fn()
		const adapter = createClaudeCodeAdapter({
			sessionId: "sess-task",
			messageId: "msg-task",
			emitter,
			onTaskStarted: started,
			onTaskFinished: finished,
		})

		adapter.handle(
			sdkMsg({ type: "system", subtype: "task_started", task_id: "bg-X", description: "X" }),
		)
		expect(started).toHaveBeenCalledWith(
			expect.objectContaining({ taskId: "bg-X", description: "X" }),
		)
		expect(finished).not.toHaveBeenCalled()

		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_notification",
				task_id: "bg-X",
				status: "completed",
				summary: "ok",
			}),
		)
		expect(finished).toHaveBeenCalledWith("bg-X")
	})

	it("correlates outputFile from Agent async_launched into onTaskStarted", () => {
		const { emitter } = createCapturingEmitter()
		const started = vi.fn()
		const adapter = createClaudeCodeAdapter({
			sessionId: "sess-out",
			messageId: "msg-out",
			emitter,
			onTaskStarted: started,
		})

		// 1. Agent tool_use opens + input arrives.
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_start",
					index: 0,
					content_block: { type: "tool_use", id: "agent-call-1", name: "Agent", input: {} },
				},
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_delta",
					index: 0,
					delta: {
						type: "input_json_delta",
						partial_json:
							'{"description":"Investigate","prompt":"find it","subagent_type":"Explore","run_in_background":true}',
					},
				},
			}),
		)
		adapter.handle(
			sdkMsg({ type: "stream_event", event: { type: "content_block_stop", index: 0 } }),
		)

		// 2. async_launched tool_result with outputFile.
		adapter.handle(
			sdkMsg({
				type: "user",
				message: {
					content: [
						{
							type: "tool_result",
							tool_use_id: "agent-call-1",
							is_error: false,
							content: [
								{
									type: "text",
									text: JSON.stringify({
										status: "async_launched",
										agentId: "a1",
										description: "Investigate",
										prompt: "find it",
										outputFile: "/tmp/subagent.md",
									}),
								},
							],
						},
					],
				},
			}),
		)

		// 3. task_started references the same tool_use_id — adapter should
		//    hand outputFile through the callback.
		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_started",
				task_id: "task-xyz",
				tool_use_id: "agent-call-1",
				description: "Investigate",
			}),
		)

		expect(started).toHaveBeenCalledWith({
			taskId: "task-xyz",
			outputFile: "/tmp/subagent.md",
			description: "Investigate",
		})
	})

	it("transitions Subagent via task_updated patch.status (in_process_teammate completion)", () => {
		const { adapter, calls } = makeAdapter()

		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_started",
				task_id: "tt-1",
				description: "developer teammate",
				task_type: "in_process_teammate",
			}),
		)
		const after = upsertsOfType(calls, "tool").filter((p) => (p.data as any).tool === "Subagent")
		expect(after.at(-1)?.data).toMatchObject({ state: "running", callId: "tt-1" })

		// SDK emits task_updated with terminal status for teammates that
		// never fire task_notification.
		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_updated",
				task_id: "tt-1",
				patch: { status: "completed", end_time: 12345 },
			}),
		)
		const terminal = upsertsOfType(calls, "tool").filter((p) => (p.data as any).tool === "Subagent")
		expect(terminal.at(-1)?.data).toMatchObject({
			state: "completed",
			metadata: expect.objectContaining({ status: "completed" }),
		})
	})

	it("maps task_updated status=killed to error state", () => {
		const { adapter, calls } = makeAdapter()

		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_started",
				task_id: "tt-2",
				description: "tester teammate",
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_updated",
				task_id: "tt-2",
				patch: { status: "killed", error: "user stopped" },
			}),
		)
		const part = upsertsOfType(calls, "tool")
			.filter((p) => (p.data as any).tool === "Subagent")
			.at(-1)
		expect(part?.data).toMatchObject({
			state: "error",
			metadata: expect.objectContaining({ status: "stopped" }),
		})
	})

	it("emits Subagent part in error state on failed task_notification", () => {
		const { adapter, calls } = makeAdapter()

		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_started",
				task_id: "bg-2",
				description: "Flaky task",
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_notification",
				task_id: "bg-2",
				status: "failed",
				summary: "Timed out",
			}),
		)
		const parts = upsertsOfType(calls, "tool").filter((p) => (p.data as any).tool === "Subagent")
		expect(parts.at(-1)?.data).toMatchObject({
			state: "error",
			error: "Timed out",
			metadata: { taskId: "bg-2", status: "failed", summary: "Timed out" },
		})
	})

	it("normalizes TodoWrite statuses in streamed input (completed→done, in_progress→in-progress)", () => {
		const { adapter, calls } = makeAdapter()

		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_start",
					index: 0,
					content_block: { type: "tool_use", id: "t-todo", name: "TodoWrite", input: {} },
				},
			}),
		)

		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_delta",
					index: 0,
					delta: {
						type: "input_json_delta",
						partial_json:
							'{"todos":[{"content":"a","status":"completed","activeForm":"A"},{"content":"b","status":"in_progress","activeForm":"B"},{"content":"c","status":"pending","activeForm":"C"}]}',
					},
				},
			}),
		)

		const last = upsertsOfType(calls, "tool").at(-1)
		const todos = (last?.data as any)?.input?.todos as Array<{ status: string }> | undefined
		expect(todos).toBeDefined()
		expect(todos?.map((t) => t.status)).toEqual(["done", "in-progress", "pending"])
	})

	it("does not leak subagent stream events into the main assistant message", () => {
		const { adapter, calls } = makeAdapter()

		// Main agent opens a Bash tool at block index 0.
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				parent_tool_use_id: null,
				event: {
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "tool_use",
						id: "main-bash",
						name: "Bash",
						input: { command: "echo main" },
					},
				},
			}),
		)

		// A subagent opens its own tool at the SAME block index under a
		// parent_tool_use_id. The main agent's timeline must not show it —
		// subagent work is surfaced only via Subagent tool cards driven by
		// `task_*` system messages.
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				parent_tool_use_id: "agent-call-xyz",
				event: {
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "tool_use",
						id: "sub-grep",
						name: "Grep",
						input: { pattern: "auth" },
					},
				},
			}),
		)

		// Subagent's tool_result — also scoped to its parent. Must be ignored
		// so it doesn't create stray parts on the main message.
		adapter.handle(
			sdkMsg({
				type: "user",
				parent_tool_use_id: "agent-call-xyz",
				message: {
					content: [
						{
							type: "tool_result",
							tool_use_id: "sub-grep",
							is_error: false,
							content: [{ type: "text", text: "found 2 matches" }],
						},
					],
				},
			}),
		)

		// Main-agent tool_result lands and resolves the Bash tool normally.
		adapter.handle(
			sdkMsg({
				type: "user",
				parent_tool_use_id: null,
				message: {
					content: [
						{
							type: "tool_result",
							tool_use_id: "main-bash",
							is_error: false,
							content: [{ type: "text", text: "main\n" }],
						},
					],
				},
			}),
		)

		const bashCalls = upsertsOfType(calls, "tool").filter((p) => (p.data as any).tool === "Bash")
		const grepCalls = upsertsOfType(calls, "tool").filter((p) => (p.data as any).tool === "Grep")
		// Main agent's Bash tool is present and resolves correctly.
		expect(new Set(bashCalls.map((p) => p.id)).size).toBe(1)
		expect(bashCalls.at(-1)?.data).toMatchObject({
			state: "completed",
			tool: "Bash",
			output: "main\n",
		})
		// Subagent's Grep tool must NOT appear on the main timeline.
		expect(grepCalls).toHaveLength(0)
	})

	it("does not emit text or reasoning parts for subagent assistant messages", () => {
		const { adapter, calls } = makeAdapter()

		// A subagent emits its final assistant message with thinking + text.
		// None of it should land on the main assistant message — otherwise
		// the main session UI would look like the main agent is streaming
		// even though its turn is already done.
		adapter.handle(
			sdkMsg({
				type: "assistant",
				parent_tool_use_id: "agent-call-xyz",
				message: {
					id: "msg_sub_1",
					content: [
						{ type: "thinking", thinking: "Searched the repo for auth middleware." },
						{ type: "text", text: "Found 2 auth handlers in src/server/auth.ts." },
					],
				},
			}),
		)

		expect(upsertsOfType(calls, "text")).toHaveLength(0)
		expect(upsertsOfType(calls, "reasoning")).toHaveLength(0)
	})

	it("does not re-emit text for main-agent assistant messages — streaming path is authoritative", () => {
		const { adapter, calls } = makeAdapter()

		adapter.handle(
			sdkMsg({
				type: "assistant",
				parent_tool_use_id: null,
				message: {
					id: "msg_main_1",
					content: [{ type: "text", text: "this would double-emit if not skipped" }],
				},
			}),
		)

		expect(upsertsOfType(calls, "text")).toHaveLength(0)
	})

	it("fires onMainAgentActive exactly once per turn on first main-agent stream activity", () => {
		const { emitter } = createCapturingEmitter()
		const onMainAgentActive = vi.fn()
		const adapter = createClaudeCodeAdapter({
			sessionId: "sess-safety-net",
			messageId: "msg-safety-net",
			emitter,
			onMainAgentActive,
		})

		adapter.beginTurn(undefined)

		// Subagent activity must NOT fire onMainAgentActive.
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				parent_tool_use_id: "agent-xyz",
				event: {
					type: "content_block_start",
					index: 0,
					content_block: { type: "text", text: "" },
				},
			}),
		)
		expect(onMainAgentActive).not.toHaveBeenCalled()

		// First main-agent stream event fires the callback.
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				parent_tool_use_id: null,
				event: {
					type: "content_block_start",
					index: 0,
					content_block: { type: "text", text: "" },
				},
			}),
		)
		expect(onMainAgentActive).toHaveBeenCalledTimes(1)

		// Subsequent main-agent events on the same turn don't re-fire.
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				parent_tool_use_id: null,
				event: {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "hello" },
				},
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				parent_tool_use_id: null,
				event: { type: "content_block_stop", index: 0 },
			}),
		)
		expect(onMainAgentActive).toHaveBeenCalledTimes(1)

		// Next turn's beginTurn resets the latch so the callback can fire
		// again on that turn's first main-agent activity.
		adapter.beginTurn(undefined)
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				parent_tool_use_id: null,
				event: {
					type: "content_block_start",
					index: 1,
					content_block: { type: "text", text: "" },
				},
			}),
		)
		expect(onMainAgentActive).toHaveBeenCalledTimes(2)
	})

	it("does not emit text parts when subagent streams text deltas", () => {
		const { adapter, calls } = makeAdapter()

		// Subagent-scoped streaming events must not create parts on the
		// main assistant message. Subagent activity is rendered via
		// Subagent tool cards (`task_*` system messages).
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				parent_tool_use_id: "agent-call-xyz",
				event: {
					type: "content_block_start",
					index: 0,
					content_block: { type: "text", text: "" },
				},
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				parent_tool_use_id: "agent-call-xyz",
				event: {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "streamed subagent text" },
				},
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				parent_tool_use_id: "agent-call-xyz",
				event: { type: "content_block_stop", index: 0 },
			}),
		)

		expect(upsertsOfType(calls, "text")).toHaveLength(0)
	})
})
