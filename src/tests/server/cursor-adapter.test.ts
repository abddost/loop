import { beforeEach, describe, expect, it } from "vitest"
import type { SessionNotification, SessionUpdateBody } from "../../server/loop/cursor/acp/types"
import type { CursorPartEmitter } from "../../server/loop/cursor/adapter"
import { createCursorAdapter } from "../../server/loop/cursor/adapter"

/**
 * Unit tests for the ACP `session/update` → Loop Part adapter.
 *
 * Drives synthetic ACP notifications through the adapter and asserts the
 * shape of the parts that hit the emitter. No subprocess, no DB, no bus —
 * the emitter is captured for inspection.
 */

function captureEmitter() {
	const upserts: Array<{ id: string; type: string; data: Record<string, unknown> }> = []
	const deltas: Array<{ partId: string; delta: string; partType: "text" | "reasoning" }> = []
	const emitter: CursorPartEmitter = {
		upsertPart: (p) => {
			upserts.push({ id: p.id, type: p.type, data: p.data })
		},
		emitDelta: (d) => {
			deltas.push(d)
		},
	}
	return { emitter, upserts, deltas }
}

function notif(sessionId: string, body: SessionUpdateBody): SessionNotification {
	return { sessionId, update: body }
}

const SID = "sess-1"

describe("createCursorAdapter", () => {
	let cap: ReturnType<typeof captureEmitter>

	beforeEach(() => {
		cap = captureEmitter()
	})

	it("emits text deltas and a final upsert on flush", () => {
		const adapter = createCursorAdapter({ emitter: cap.emitter })
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Hello" },
			}),
		)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: " world" },
			}),
		)
		adapter.finalize()

		const texts = cap.deltas.filter((d) => d.partType === "text")
		expect(texts.map((d) => d.delta)).toEqual(["Hello", " world"])

		const textUpserts = cap.upserts.filter((u) => u.type === "text")
		expect(textUpserts).toHaveLength(1)
		expect(textUpserts[0].data.text).toBe("Hello world")
	})

	it("opens a step-start before any tool/text activity", () => {
		const adapter = createCursorAdapter({ emitter: cap.emitter })
		adapter.beginTurn("snap-1")
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-1",
				title: "Read foo.ts",
				kind: "read",
				status: "in_progress",
				rawInput: { path: "foo.ts" },
			}),
		)
		const stepStart = cap.upserts.find((u) => u.type === "step-start")
		expect(stepStart).toBeDefined()
		expect(stepStart?.data.snapshot).toBe("snap-1")
	})

	it("renders a Read tool with input.path derivable from rawInput", () => {
		const adapter = createCursorAdapter({ emitter: cap.emitter })
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-1",
				title: "Read foo/bar.ts",
				kind: "read",
				status: "in_progress",
				rawInput: { path: "foo/bar.ts" },
			}),
		)
		const tool = cap.upserts.find((u) => u.type === "tool")
		expect(tool).toBeDefined()
		expect(tool?.data.tool).toBe("read")
		expect((tool?.data.input as Record<string, unknown>)?.path).toBe("foo/bar.ts")
		expect(tool?.data.state).toBe("running")
	})

	it("falls back to title-parsed path when rawInput is opaque", () => {
		const adapter = createCursorAdapter({ emitter: cap.emitter })
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-1",
				title: "Read src/lib/product.ts",
				kind: "read",
				status: "completed",
				rawInput: undefined,
			}),
		)
		const tool = cap.upserts.find((u) => u.type === "tool")
		expect((tool?.data.input as Record<string, unknown>)?.path).toBe("src/lib/product.ts")
	})

	it("falls back to locations[0].path when rawInput and title are unhelpful", () => {
		const adapter = createCursorAdapter({ emitter: cap.emitter })
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-1",
				title: "Read",
				kind: "read",
				status: "completed",
				locations: [{ path: "located/at/foo.ts" }],
			}),
		)
		const tool = cap.upserts.find((u) => u.type === "tool")
		expect((tool?.data.input as Record<string, unknown>)?.path).toBe("located/at/foo.ts")
	})

	it("renders Grep with input.pattern derived from title quotes", () => {
		const adapter = createCursorAdapter({ emitter: cap.emitter })
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-1",
				title: 'Grep "useState"',
				kind: "search",
				status: "completed",
			}),
		)
		const tool = cap.upserts.find((u) => u.type === "tool")
		expect(tool?.data.tool).toBe("grep")
		expect((tool?.data.input as Record<string, unknown>)?.pattern).toBe("useState")
	})

	it("renders Bash with command from rawInput.command", () => {
		const adapter = createCursorAdapter({ emitter: cap.emitter })
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-1",
				title: "Run command",
				kind: "execute",
				status: "in_progress",
				rawInput: { command: "git status -sb", cwd: "/tmp" },
			}),
		)
		const tool = cap.upserts.find((u) => u.type === "tool")
		expect(tool?.data.tool).toBe("bash")
		expect((tool?.data.input as Record<string, unknown>)?.command).toBe("git status -sb")
		expect((tool?.data.input as Record<string, unknown>)?.cwd).toBe("/tmp")
	})

	it("streams bash output through metadata.output while running", () => {
		const adapter = createCursorAdapter({ emitter: cap.emitter })
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-1",
				title: "Bash",
				kind: "execute",
				status: "in_progress",
				rawInput: { command: "ls" },
				content: [{ type: "content", content: { type: "text", text: "file1.ts\nfile2.ts" } }],
			}),
		)
		const tool = cap.upserts.find((u) => u.type === "tool")
		const meta = tool?.data.metadata as Record<string, unknown> | undefined
		expect(meta?.output).toBe("file1.ts\nfile2.ts")
	})

	it("converts diff content blocks into metadata.diff (no separate edit Part)", () => {
		// We deliberately do NOT emit a per-tool `edit` Part — the
		// finalize-time snapshot diff is the canonical source for the
		// EditDiff aggregator, and emitting both led to duplicate file
		// rows (cursor's diff paths vs git's workspace-relative paths).
		// The inline diff display reads metadata.diff off the tool Part
		// directly.
		const adapter = createCursorAdapter({ emitter: cap.emitter })
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-1",
				title: "Edit foo.ts",
				kind: "edit",
				status: "completed",
				locations: [{ path: "foo.ts" }],
				content: [
					{
						type: "diff",
						path: "foo.ts",
						oldText: "old line",
						newText: "new line",
					},
				],
			}),
		)

		const tool = cap.upserts.find((u) => u.type === "tool")
		expect(tool?.data.tool).toBe("edit")
		expect((tool?.data.input as Record<string, unknown>)?.path).toBe("foo.ts")
		const meta = tool?.data.metadata as Record<string, unknown> | undefined
		expect(typeof meta?.diff).toBe("string")
		expect((meta?.diff as string).includes("--- a/foo.ts")).toBe(true)
		expect((meta?.diff as string).includes("+new line")).toBe(true)

		// No per-tool edit Part — the finalize-time snapshot Part owns
		// the bottom-of-message aggregator.
		const editPart = cap.upserts.find((u) => u.type === "edit")
		expect(editPart).toBeUndefined()
	})

	it("does NOT extract generic single-word title-paths (e.g. 'Read File' → 'File')", () => {
		// Cursor's tool emissions sometimes use generic placeholders in
		// the title — "Read File", "Edited File". The title parser must
		// reject these (no `/`, no `.`, not a known extensionless name)
		// so the renderer falls back to `metadata.title` verbatim instead
		// of rendering a broken FileReference for "File".
		const adapter = createCursorAdapter({ emitter: cap.emitter })
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-generic-read",
				title: "Read File",
				kind: "read",
				status: "completed",
				rawInput: {},
			}),
		)
		const tool = cap.upserts.find((u) => u.type === "tool")
		expect(tool?.data.tool).toBe("read")
		// Generic single-word title-extract → input.path stays unset.
		const input = tool?.data.input as Record<string, unknown> | undefined
		expect(input?.path).toBeUndefined()
		// But cursor's title is preserved in metadata for the renderer
		// to display as a fallback label.
		const meta = tool?.data.metadata as Record<string, unknown> | undefined
		expect(meta?.title).toBe("Read File")
	})

	it("DOES extract title-paths that look real (Read src/foo.ts, Read package.json)", () => {
		// Real paths have `/` or `.` — those should be extracted.
		const adapter = createCursorAdapter({ emitter: cap.emitter })
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-real-read",
				title: "Read package.json",
				kind: "read",
				status: "completed",
				rawInput: {},
			}),
		)
		const tool = cap.upserts.find((u) => u.type === "tool")
		const input = tool?.data.input as Record<string, unknown> | undefined
		expect(input?.path).toBe("package.json")
	})

	it("preserves cursor's title in metadata.title for renderer fallback", () => {
		// Renderers (GrepToolCall, ReadToolCall, GlobToolCall, ListToolCall)
		// fall back to metadata.title when their primary input field is
		// missing — matching t3code's "always show something" approach.
		const adapter = createCursorAdapter({ emitter: cap.emitter })
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-grep",
				title: "Searched for useState",
				kind: "search",
				status: "completed",
				rawInput: {},
			}),
		)
		const tool = cap.upserts.find((u) => u.type === "tool")
		const meta = tool?.data.metadata as Record<string, unknown> | undefined
		expect(meta?.title).toBe("Searched for useState")
	})

	it("uses diff content block path when rawInput is empty (input.path resolves to real filename)", () => {
		// The screenshot bug: cursor emits Edit with empty rawInput +
		// generic title "Edited File" + diff blocks containing the real
		// path. Per-tool display must show "App.tsx", not "File".
		const adapter = createCursorAdapter({ emitter: cap.emitter })
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-screenshot-edit",
				title: "Edited File",
				kind: "edit",
				status: "completed",
				rawInput: {},
				content: [
					{
						type: "diff",
						path: "src/App.tsx",
						oldText: "old",
						newText: "new",
					},
				],
			}),
		)

		const tool = cap.upserts.find((u) => u.type === "tool")
		expect(tool?.data.tool).toBe("edit")
		expect((tool?.data.input as Record<string, unknown>)?.path).toBe("src/App.tsx")
	})

	it("status pending → running → completed transitions persist correctly", () => {
		const adapter = createCursorAdapter({ emitter: cap.emitter })
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-1",
				title: "Read foo.ts",
				kind: "read",
				status: "pending",
				rawInput: { path: "foo.ts" },
			}),
		)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call_update",
				toolCallId: "t-1",
				status: "in_progress",
			}),
		)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call_update",
				toolCallId: "t-1",
				status: "completed",
				content: [{ type: "content", content: { type: "text", text: "file contents" } }],
			}),
		)

		const toolUpserts = cap.upserts.filter((u) => u.type === "tool")
		const states = toolUpserts.map((u) => u.data.state)
		expect(states).toEqual(["pending", "running", "completed"])
		expect(toolUpserts[2].data.output).toBe("file contents")
	})

	it("ignores reverts after a terminal state", () => {
		const adapter = createCursorAdapter({ emitter: cap.emitter })
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-1",
				title: "Read x",
				kind: "read",
				status: "completed",
				rawInput: { path: "x" },
			}),
		)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call_update",
				toolCallId: "t-1",
				status: "in_progress",
			}),
		)
		const toolUpserts = cap.upserts.filter((u) => u.type === "tool")
		const lastState = toolUpserts[toolUpserts.length - 1].data.state
		// Revert is rewritten to completed
		expect(lastState).toBe("completed")
	})

	it("partitions text → tool → text into distinct partIds for ordering", () => {
		const adapter = createCursorAdapter({ emitter: cap.emitter })
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "Before " },
			}),
		)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-1",
				title: "Read y",
				kind: "read",
				status: "completed",
				rawInput: { path: "y" },
			}),
		)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "agent_message_chunk",
				content: { type: "text", text: "After " },
			}),
		)
		adapter.finalize()
		const textUpserts = cap.upserts.filter((u) => u.type === "text")
		expect(textUpserts).toHaveLength(2)
		expect(textUpserts[0].id).not.toBe(textUpserts[1].id)
	})

	it("forwards usage_update through onUsageUpdate", () => {
		const usages: unknown[] = []
		const adapter = createCursorAdapter({
			emitter: cap.emitter,
			onUsageUpdate: (u) => {
				usages.push(u)
			},
		})
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "usage_update",
				size: 200000,
				used: 12345,
				cost: { amount: 0.42, currency: "USD" },
			}),
		)
		expect(usages).toHaveLength(1)
		expect((usages[0] as { used?: number }).used).toBe(12345)
		expect((usages[0] as { cost?: number }).cost).toBe(0.42)
	})

	it("forwards current_mode_update through onModeChange", () => {
		const modes: string[] = []
		const adapter = createCursorAdapter({
			emitter: cap.emitter,
			onModeChange: (id) => {
				modes.push(id)
			},
		})
		adapter.beginTurn(undefined)
		adapter.handle(notif(SID, { sessionUpdate: "current_mode_update", currentModeId: "plan" }))
		expect(modes).toEqual(["plan"])
	})

	it("flips unfinalized tools to error on finalize", () => {
		const adapter = createCursorAdapter({ emitter: cap.emitter })
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-1",
				title: "Read x",
				kind: "read",
				status: "in_progress",
				rawInput: { path: "x" },
			}),
		)
		adapter.finalize({ finishReason: "abort" })
		const toolUpserts = cap.upserts.filter((u) => u.type === "tool")
		const last = toolUpserts[toolUpserts.length - 1]
		expect(last.data.state).toBe("error")
	})

	it("emits step-finish at finalize with the right finishReason", () => {
		const adapter = createCursorAdapter({ emitter: cap.emitter })
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "ok" } }),
		)
		adapter.finalize({ finishReason: "stop" })
		const stepFinish = cap.upserts.find((u) => u.type === "step-finish")
		expect(stepFinish?.data.finishReason).toBe("stop")
	})

	describe("Defense 4: forbidden-tool detection in plan mode", () => {
		const PLAN_SID = "01ABCDEFGHJKLMNPQRSTVWXYZ0"
		const PLAN_FILE = `.loop/plans/${PLAN_SID}.md`

		it("does NOT fire onForbiddenTool when planModeActive is false", () => {
			const fired: unknown[] = []
			const adapter = createCursorAdapter({
				emitter: cap.emitter,
				loopSessionId: PLAN_SID,
				onForbiddenTool: (info) => fired.push(info),
				planModeActive: false,
			})
			adapter.beginTurn(undefined)
			adapter.handle(
				notif(SID, {
					sessionUpdate: "tool_call",
					toolCallId: "t1",
					title: "Edit src/foo.ts",
					kind: "edit",
					status: "in_progress",
					rawInput: { path: "src/foo.ts" },
				}),
			)
			expect(fired).toHaveLength(0)
		})

		it("fires onForbiddenTool when plan mode active + edit on non-plan path", () => {
			const fired: Array<{ tool: string; targetPath?: string; reason: string }> = []
			const adapter = createCursorAdapter({
				emitter: cap.emitter,
				loopSessionId: PLAN_SID,
				onForbiddenTool: (info) =>
					fired.push({
						tool: info.tool,
						targetPath: info.targetPath ?? undefined,
						reason: info.reason,
					}),
				planModeActive: true,
			})
			adapter.beginTurn(undefined)
			adapter.handle(
				notif(SID, {
					sessionUpdate: "tool_call",
					toolCallId: "t1",
					title: "Edit src/foo.ts",
					kind: "edit",
					status: "in_progress",
					rawInput: { path: "src/foo.ts" },
				}),
			)
			expect(fired).toHaveLength(1)
			expect(fired[0].tool).toBe("edit")
			expect(fired[0].targetPath).toBe("src/foo.ts")
			expect(fired[0].reason).toMatch(/plan/i)
		})

		it("does NOT fire onForbiddenTool when edit targets the plan file", () => {
			const fired: unknown[] = []
			const adapter = createCursorAdapter({
				emitter: cap.emitter,
				loopSessionId: PLAN_SID,
				onForbiddenTool: (info) => fired.push(info),
				planModeActive: true,
			})
			adapter.beginTurn(undefined)
			adapter.handle(
				notif(SID, {
					sessionUpdate: "tool_call",
					toolCallId: "t1",
					title: "Edit plan",
					kind: "edit",
					status: "in_progress",
					rawInput: { path: PLAN_FILE },
				}),
			)
			expect(fired).toHaveLength(0)
		})

		it("marks the offending tool part as failed (not 'completed')", () => {
			const adapter = createCursorAdapter({
				emitter: cap.emitter,
				loopSessionId: PLAN_SID,
				onForbiddenTool: () => {},
				planModeActive: true,
			})
			adapter.beginTurn(undefined)
			adapter.handle(
				notif(SID, {
					sessionUpdate: "tool_call",
					toolCallId: "t1",
					title: "Edit src/foo.ts",
					kind: "edit",
					status: "completed",
					rawInput: { path: "src/foo.ts" },
				}),
			)
			const toolPart = cap.upserts.find((u) => u.type === "tool")
			expect(toolPart?.data.state).toBe("error")
		})

		it("does NOT fire on initial 'pending' status — waits for in_progress/completed", () => {
			// Cursor's first tool_call event often arrives with empty
			// rawInput; the real path lands in a later tool_call_update.
			// Defense 4 must not preemptively reject on pending events.
			const fired: unknown[] = []
			const adapter = createCursorAdapter({
				emitter: cap.emitter,
				loopSessionId: PLAN_SID,
				onForbiddenTool: (info) => fired.push(info),
				planModeActive: true,
			})
			adapter.beginTurn(undefined)
			adapter.handle(
				notif(SID, {
					sessionUpdate: "tool_call",
					toolCallId: "t1",
					title: "Edited File",
					kind: "edit",
					status: "pending",
					rawInput: {},
				}),
			)
			expect(fired).toHaveLength(0)
		})

		it("does NOT fire when title-derived path is the only candidate (no concrete rawInput/locations)", () => {
			// Cursor's title might be "Edited File" with rawInput empty.
			// deriveLoopTool may set tool.input.path = "File" via title
			// parsing — but Defense 4 must NOT use that title-derived path.
			// Without concrete rawInput.path or locations, let the call
			// proceed (Defense 1/3 catch real violations).
			const fired: unknown[] = []
			const adapter = createCursorAdapter({
				emitter: cap.emitter,
				loopSessionId: PLAN_SID,
				onForbiddenTool: (info) => fired.push(info),
				planModeActive: true,
			})
			adapter.beginTurn(undefined)
			adapter.handle(
				notif(SID, {
					sessionUpdate: "tool_call",
					toolCallId: "t1",
					title: "Edited File",
					kind: "edit",
					status: "in_progress",
					rawInput: {},
				}),
			)
			expect(fired).toHaveLength(0)
		})

		it("uses locations[] for path when rawInput is empty", () => {
			const fired: Array<{ targetPath?: string }> = []
			const adapter = createCursorAdapter({
				emitter: cap.emitter,
				loopSessionId: PLAN_SID,
				onForbiddenTool: (info) => fired.push({ targetPath: info.targetPath ?? undefined }),
				planModeActive: true,
			})
			adapter.beginTurn(undefined)
			adapter.handle(
				notif(SID, {
					sessionUpdate: "tool_call",
					toolCallId: "t1",
					title: "Edited File",
					kind: "edit",
					status: "in_progress",
					rawInput: {},
					locations: [{ path: "src/App.tsx" }],
				}),
			)
			expect(fired).toHaveLength(1)
			expect(fired[0].targetPath).toBe("src/App.tsx")
		})

		it("only fires once per callId even on repeated tool_call_update events", () => {
			const fired: unknown[] = []
			const adapter = createCursorAdapter({
				emitter: cap.emitter,
				loopSessionId: PLAN_SID,
				onForbiddenTool: (info) => fired.push(info),
				planModeActive: true,
			})
			adapter.beginTurn(undefined)
			adapter.handle(
				notif(SID, {
					sessionUpdate: "tool_call",
					toolCallId: "t1",
					title: "Edit src/foo.ts",
					kind: "edit",
					status: "pending",
					rawInput: { path: "src/foo.ts" },
				}),
			)
			adapter.handle(
				notif(SID, {
					sessionUpdate: "tool_call_update",
					toolCallId: "t1",
					status: "in_progress",
				}),
			)
			adapter.handle(
				notif(SID, {
					sessionUpdate: "tool_call_update",
					toolCallId: "t1",
					status: "completed",
				}),
			)
			expect(fired).toHaveLength(1)
		})
	})

	describe("injectExternalTodoWrite (cursor/update_todos extension)", () => {
		it("emits a todowrite tool part with normalised statuses", () => {
			// Cursor sends pending | in_progress | completed | cancelled.
			// Loop renderer expects pending | in-progress | done.
			const adapter = createCursorAdapter({ emitter: cap.emitter })
			adapter.beginTurn(undefined)
			adapter.injectExternalTodoWrite({
				todos: [
					{ id: "t1", content: "task one", status: "in_progress" },
					{ id: "t2", content: "task two", status: "completed" },
					{ id: "t3", content: "task three", status: "pending" },
					{ id: "t4", content: "task four", status: "cancelled" },
				],
				merge: false,
			})
			const tool = cap.upserts.find((u) => u.type === "tool")
			expect(tool?.data.tool).toBe("todowrite")
			const meta = tool?.data.metadata as Record<string, unknown> | undefined
			const todos = meta?.todos as Array<{ id: string; status: string }>
			expect(todos).toHaveLength(4)
			expect(todos[0].status).toBe("in-progress")
			expect(todos[1].status).toBe("done")
			expect(todos[2].status).toBe("pending")
			expect(todos[3].status).toBe("pending") // cancelled → pending visually
		})

		it("merge: true patches existing items by id, preserves the rest", () => {
			const adapter = createCursorAdapter({ emitter: cap.emitter })
			adapter.beginTurn(undefined)
			// First call — replace
			adapter.injectExternalTodoWrite({
				todos: [
					{ id: "t1", content: "first", status: "in_progress" },
					{ id: "t2", content: "second", status: "pending" },
					{ id: "t3", content: "third", status: "pending" },
				],
				merge: false,
			})
			// Second call — patch t1 → completed, t2 → in_progress
			adapter.injectExternalTodoWrite({
				todos: [
					{ id: "t1", content: "first", status: "completed" },
					{ id: "t2", content: "second", status: "in_progress" },
				],
				merge: true,
			})
			const lastTool = cap.upserts.filter((u) => u.type === "tool").pop()
			const meta = lastTool?.data.metadata as Record<string, unknown> | undefined
			const todos = meta?.todos as Array<{ id: string; status: string }>
			expect(todos).toHaveLength(3)
			const byId = Object.fromEntries(todos.map((t) => [t.id, t.status]))
			expect(byId.t1).toBe("done")
			expect(byId.t2).toBe("in-progress")
			expect(byId.t3).toBe("pending") // preserved through merge
		})

		it("merge: false replaces the entire list", () => {
			const adapter = createCursorAdapter({ emitter: cap.emitter })
			adapter.beginTurn(undefined)
			adapter.injectExternalTodoWrite({
				todos: [{ id: "old1", content: "old", status: "pending" }],
				merge: false,
			})
			adapter.injectExternalTodoWrite({
				todos: [{ id: "new1", content: "new", status: "pending" }],
				merge: false,
			})
			const lastTool = cap.upserts.filter((u) => u.type === "tool").pop()
			const meta = lastTool?.data.metadata as Record<string, unknown> | undefined
			const todos = meta?.todos as Array<{ id: string }>
			expect(todos).toHaveLength(1)
			expect(todos[0].id).toBe("new1")
		})

		it("uses a stable partId so repeated calls update the same UI row", () => {
			const adapter = createCursorAdapter({ emitter: cap.emitter })
			adapter.beginTurn(undefined)
			adapter.injectExternalTodoWrite({
				todos: [{ id: "t1", content: "a", status: "pending" }],
			})
			adapter.injectExternalTodoWrite({
				todos: [{ id: "t1", content: "a", status: "completed" }],
				merge: true,
			})
			const toolUpserts = cap.upserts.filter((u) => u.type === "tool")
			expect(toolUpserts).toHaveLength(2)
			expect(toolUpserts[0].id).toBe(toolUpserts[1].id)
		})

		it("falls back to title and synthesised id when item fields are missing", () => {
			const adapter = createCursorAdapter({ emitter: cap.emitter })
			adapter.beginTurn(undefined)
			adapter.injectExternalTodoWrite({
				todos: [
					// No id, no content — but has title.
					{ title: "fallback title", status: "pending" },
					// Truly empty — should still synthesise content.
					{ status: "pending" },
				],
			})
			const tool = cap.upserts.find((u) => u.type === "tool")
			const meta = tool?.data.metadata as Record<string, unknown> | undefined
			const todos = meta?.todos as Array<{ id: string; content: string }>
			expect(todos[0].content).toBe("fallback title")
			expect(todos[0].id).toBe("todo-0")
			expect(todos[1].content).toBe("Step 2")
			expect(todos[1].id).toBe("todo-1")
		})

		it("suppresses stub todowrite tool_call events once the extension has fired", () => {
			// Cursor sends two channels: the cursor/update_todos extension
			// (real data) AND a tool_call with empty rawInput (stub). The
			// stub creates "Todo: 0 tasks" rows alongside the populated
			// extension row. Once injectExternalTodoWrite has been called,
			// subsequent empty tool_calls must be suppressed.
			const adapter = createCursorAdapter({ emitter: cap.emitter })
			adapter.beginTurn(undefined)
			adapter.injectExternalTodoWrite({
				todos: [{ id: "t1", content: "real task", status: "in_progress" }],
				merge: false,
			})
			// Now cursor sends the stub tool_call.
			adapter.handle(
				notif(SID, {
					sessionUpdate: "tool_call",
					toolCallId: "stub-1",
					title: "Updated todos",
					kind: "other",
					status: "completed",
					rawInput: {},
				}),
			)
			const toolUpserts = cap.upserts.filter((u) => u.type === "tool")
			// One row total — the populated one from the extension.
			expect(toolUpserts).toHaveLength(1)
			const meta = toolUpserts[0].data.metadata as Record<string, unknown> | undefined
			const todos = meta?.todos as Array<{ content: string }>
			expect(todos[0].content).toBe("real task")
		})

		it("does NOT suppress a tool_call that has its OWN populated todos", () => {
			// If a cursor version sends UpdateTodos data inline in
			// rawInput.todos (no extension request), the tool_call must
			// render normally — our suppression only triggers for the
			// "stub alongside extension" case.
			const adapter = createCursorAdapter({ emitter: cap.emitter })
			adapter.beginTurn(undefined)
			adapter.handle(
				notif(SID, {
					sessionUpdate: "tool_call",
					toolCallId: "inline-1",
					title: "Updated todos",
					kind: "other",
					status: "completed",
					rawInput: {
						todos: [{ id: "x", content: "inline task", status: "completed" }],
					},
				}),
			)
			const toolUpserts = cap.upserts.filter((u) => u.type === "tool")
			expect(toolUpserts).toHaveLength(1)
			expect(toolUpserts[0].data.tool).toBe("todowrite")
		})

		it("marks state=completed only when EVERY todo is done", () => {
			const adapter = createCursorAdapter({ emitter: cap.emitter })
			adapter.beginTurn(undefined)
			adapter.injectExternalTodoWrite({
				todos: [
					{ id: "t1", content: "a", status: "completed" },
					{ id: "t2", content: "b", status: "completed" },
				],
			})
			const tool = cap.upserts.find((u) => u.type === "tool")
			expect(tool?.data.state).toBe("completed")

			// Reset and try with one not-done item.
			cap.upserts.length = 0
			adapter.beginTurn(undefined)
			adapter.injectExternalTodoWrite({
				todos: [
					{ id: "t1", content: "a", status: "completed" },
					{ id: "t2", content: "b", status: "pending" },
				],
			})
			const tool2 = cap.upserts.find((u) => u.type === "tool")
			expect(tool2?.data.state).toBe("running")
		})
	})
})
