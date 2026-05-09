import { describe, expect, it, vi } from "vitest"
import {
	type PartEmitter,
	type SdkMessageLike,
	createClaudeCodeAdapter,
} from "../../server/loop/claude-code/adapter"

/**
 * Tests for the subagent completion cleanup path:
 *   - `cleanupRunningTasks(reason)` transitions in-flight Subagent parts
 *     to a terminal `error` state when the session is closed before the
 *     SDK delivers a `task_notification`.
 *   - `task_notification` and terminal `task_updated` messages backfill
 *     the parent Agent tool's state via `tool_use_id` so a successful
 *     subagent doesn't leave its synchronous Agent tool card spinning.
 */

function createCapturingEmitter() {
	const calls: Array<{
		kind: "upsert"
		part: { id: string; type: string; data: Record<string, unknown> }
	}> = []
	const emitter: PartEmitter = {
		upsertPart: (part) => {
			calls.push({
				kind: "upsert",
				part: { id: part.id, type: part.type, data: part.data },
			})
		},
		emitDelta: () => {},
	}
	return { emitter, calls }
}

function upserts(calls: ReturnType<typeof createCapturingEmitter>["calls"], type: string) {
	return calls.flatMap((c) => (c.part.type === type ? [c.part] : []))
}

function sdkMsg(partial: Partial<SdkMessageLike> & { type: string }): SdkMessageLike {
	return partial
}

describe("cleanupRunningTasks", () => {
	it("transitions running Subagent parts to error/stopped with the given reason", () => {
		const { emitter, calls } = createCapturingEmitter()
		const finished = vi.fn()
		const adapter = createClaudeCodeAdapter({
			sessionId: "sess-1",
			messageId: "msg-1",
			emitter,
			onTaskFinished: finished,
		})

		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_started",
				task_id: "bg-A",
				description: "Investigate",
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_started",
				task_id: "bg-B",
				description: "Probe",
			}),
		)

		adapter.cleanupRunningTasks("Session closed before subagent completed")

		const subagentParts = upserts(calls, "tool").filter(
			(p) => (p.data as { tool: string }).tool === "Subagent",
		)
		const terminalForA = subagentParts
			.filter((p) => (p.data as { callId: string }).callId === "bg-A")
			.at(-1)
		const terminalForB = subagentParts
			.filter((p) => (p.data as { callId: string }).callId === "bg-B")
			.at(-1)

		expect(terminalForA?.data).toMatchObject({
			state: "error",
			error: "Session closed before subagent completed",
			metadata: expect.objectContaining({
				status: "stopped",
				summary: "Session closed before subagent completed",
			}),
		})
		expect(terminalForB?.data).toMatchObject({
			state: "error",
			metadata: expect.objectContaining({ status: "stopped" }),
		})
		expect(finished).toHaveBeenCalledWith("bg-A")
		expect(finished).toHaveBeenCalledWith("bg-B")
	})

	it("is a no-op when no tasks are in flight", () => {
		const { emitter, calls } = createCapturingEmitter()
		const adapter = createClaudeCodeAdapter({
			sessionId: "sess-2",
			messageId: "msg-2",
			emitter,
		})

		adapter.cleanupRunningTasks("nothing to clean")

		expect(calls).toEqual([])
	})

	it("does not re-fire after a real task_notification has resolved the task", () => {
		const { emitter, calls } = createCapturingEmitter()
		const finished = vi.fn()
		const adapter = createClaudeCodeAdapter({
			sessionId: "sess-3",
			messageId: "msg-3",
			emitter,
			onTaskFinished: finished,
		})

		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_started",
				task_id: "bg-C",
				description: "Done quickly",
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_notification",
				task_id: "bg-C",
				status: "completed",
				summary: "ok",
			}),
		)
		expect(finished).toHaveBeenCalledTimes(1)

		const before = calls.length
		adapter.cleanupRunningTasks("late close")
		expect(calls.length).toBe(before)
		expect(finished).toHaveBeenCalledTimes(1)
	})
})

describe("Agent tool ↔ background task crosslink", () => {
	function openAgentTool(adapter: ReturnType<typeof createClaudeCodeAdapter>): void {
		adapter.handle(
			sdkMsg({
				type: "stream_event",
				event: {
					type: "content_block_start",
					index: 0,
					content_block: { type: "tool_use", id: "agent-1", name: "Agent", input: {} },
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
							'{"description":"Investigate","prompt":"x","subagent_type":"Explore","run_in_background":true}',
					},
				},
			}),
		)
		adapter.handle(
			sdkMsg({ type: "stream_event", event: { type: "content_block_stop", index: 0 } }),
		)
	}

	it("backfills the parent Agent tool to completed when task_notification arrives without a tool_result", () => {
		const { emitter, calls } = createCapturingEmitter()
		const adapter = createClaudeCodeAdapter({
			sessionId: "sess-x",
			messageId: "msg-x",
			emitter,
		})

		openAgentTool(adapter)
		// task_started carries the same tool_use_id so the adapter can
		// link Subagent ↔ Agent tool.
		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_started",
				task_id: "bg-link-1",
				tool_use_id: "agent-1",
				description: "Investigate",
			}),
		)

		const beforeTerminal = upserts(calls, "tool")
			.filter((p) => (p.data as { tool: string }).tool === "Agent")
			.at(-1)
		expect(beforeTerminal?.data).toMatchObject({ state: "running" })

		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_notification",
				task_id: "bg-link-1",
				tool_use_id: "agent-1",
				status: "completed",
				summary: "Found 5 callers",
			}),
		)

		const agentTerminal = upserts(calls, "tool")
			.filter((p) => (p.data as { tool: string }).tool === "Agent")
			.at(-1)
		expect(agentTerminal?.data).toMatchObject({
			state: "completed",
			output: "Found 5 callers",
		})
	})

	it("backfills the parent Agent tool to error when task_updated reports a terminal failure", () => {
		const { emitter, calls } = createCapturingEmitter()
		const adapter = createClaudeCodeAdapter({
			sessionId: "sess-y",
			messageId: "msg-y",
			emitter,
		})

		openAgentTool(adapter)
		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_started",
				task_id: "bg-link-2",
				tool_use_id: "agent-1",
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_updated",
				task_id: "bg-link-2",
				patch: { status: "killed", error: "user cancelled" },
			}),
		)

		const agentTerminal = upserts(calls, "tool")
			.filter((p) => (p.data as { tool: string }).tool === "Agent")
			.at(-1)
		expect(agentTerminal?.data).toMatchObject({
			state: "error",
			error: "user cancelled",
		})
	})

	it("leaves a foreground-resolved Agent tool alone when its background task closes later", () => {
		const { emitter, calls } = createCapturingEmitter()
		const adapter = createClaudeCodeAdapter({
			sessionId: "sess-z",
			messageId: "msg-z",
			emitter,
		})

		openAgentTool(adapter)
		// Foreground tool_result arrives first and resolves the Agent tool.
		adapter.handle(
			sdkMsg({
				type: "user",
				message: {
					content: [
						{
							type: "tool_result",
							tool_use_id: "agent-1",
							is_error: false,
							content: [
								{ type: "text", text: '{"status":"async_launched","outputFile":"/tmp/x.md"}' },
							],
						},
					],
				},
			}),
		)
		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_started",
				task_id: "bg-link-3",
				tool_use_id: "agent-1",
			}),
		)
		const beforeNotify = upserts(calls, "tool").filter(
			(p) => (p.data as { tool: string }).tool === "Agent",
		).length
		adapter.handle(
			sdkMsg({
				type: "system",
				subtype: "task_notification",
				task_id: "bg-link-3",
				tool_use_id: "agent-1",
				status: "completed",
				summary: "later",
			}),
		)
		const afterNotify = upserts(calls, "tool").filter(
			(p) => (p.data as { tool: string }).tool === "Agent",
		).length
		// The notification should not re-emit a new Agent tool part — the
		// foreground tool_result already resolved it.
		expect(afterNotify).toBe(beforeNotify)
	})
})
