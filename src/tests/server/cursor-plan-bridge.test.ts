import { beforeEach, describe, expect, it } from "vitest"
import type { SessionNotification, SessionUpdateBody } from "../../server/loop/cursor/acp/types"
import { type CursorPartEmitter, createCursorAdapter } from "../../server/loop/cursor/adapter"

/**
 * Bridge tests for the plan workflow under Cursor.
 *
 * Cursor's agent doesn't have access to Loop's plan_write/plan_exit tools.
 * The adapter compensates by:
 *   1. Detecting Edit/Write to `.loop/plans/<sessionId>.md` and treating
 *      it as a `plan-write` tool part
 *   2. Recognising Cursor's CreatePlan tool by title and falling back to
 *      the same path
 *   3. Firing `onPlanWritten` once per turn so the runtime can prompt the
 *      user for approval at end-of-turn
 *   4. Letting the runtime inject a synthetic plan-write part when the
 *      `cursor/create_plan` ACP extension fires
 */

const SID = "01ABCDEFGHJKLMNPQRSTVWXYZ0"

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

describe("createCursorAdapter — plan bridge", () => {
	let cap: ReturnType<typeof captureEmitter>
	let planWrites: Array<{ planPath: string; planContent: string }>

	beforeEach(() => {
		cap = captureEmitter()
		planWrites = []
	})

	function makeAdapter(loopSessionId: string | undefined = SID) {
		return createCursorAdapter({
			emitter: cap.emitter,
			loopSessionId,
			onPlanWritten: (info) => {
				planWrites.push(info)
			},
		})
	}

	it("normalises Edit to .loop/plans/<id>.md as a plan-write tool", () => {
		const adapter = makeAdapter()
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-1",
				title: "Edit plan",
				kind: "edit",
				status: "completed",
				rawInput: { path: `.loop/plans/${SID}.md`, content: "# Plan\nDo X" },
			}),
		)
		const tool = cap.upserts.find((u) => u.type === "tool")
		expect(tool?.data.tool).toBe("plan-write")
		const meta = tool?.data.metadata as Record<string, unknown> | undefined
		expect(meta?.planPath).toBe(`.loop/plans/${SID}.md`)
		expect(meta?.planContent).toBe("# Plan\nDo X")
	})

	it("normalises Write to .loop/plans/<id>.md as a plan-write tool", () => {
		const adapter = makeAdapter()
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-2",
				title: "Write plan",
				kind: "edit",
				status: "completed",
				locations: [{ path: `.loop/plans/${SID}.md` }],
				rawInput: { fileText: "# Plan\nNotes" },
			}),
		)
		const tool = cap.upserts.find((u) => u.type === "tool")
		expect(tool?.data.tool).toBe("plan-write")
		const meta = tool?.data.metadata as Record<string, unknown> | undefined
		expect(meta?.planPath).toBe(`.loop/plans/${SID}.md`)
		expect(meta?.planContent).toBe("# Plan\nNotes")
	})

	it("recognises absolute paths and ./.loop/plans/ prefixes", () => {
		const adapter = makeAdapter()
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-3",
				title: "Edit plan",
				kind: "edit",
				status: "completed",
				rawInput: {
					path: `/Users/me/proj/.loop/plans/${SID}.md`,
					content: "abs path plan",
				},
			}),
		)
		const tool = cap.upserts.find((u) => u.type === "tool")
		expect(tool?.data.tool).toBe("plan-write")
	})

	it("populates metadata.planPath/planContent from diff content blocks (the screenshot bug)", () => {
		// Exact scenario from the screenshot: cursor's Edit tool emits
		// with empty rawInput, generic title, and the real path + content
		// only in the diff content blocks. Plan-path extraction MUST find
		// the path in the diff block — otherwise onPlanWritten never fires
		// and the runtime can't synthesize the plan-exit Part for PlanCard.
		const adapter = makeAdapter()
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-screenshot",
				title: "Edited File",
				kind: "edit",
				status: "completed",
				rawInput: {},
				content: [
					{
						type: "diff",
						path: `.loop/plans/${SID}.md`,
						oldText: null,
						newText: "# Plan\n## Context\n## Approach\n## Files\n## Reuse\n## Verification",
					},
				],
			}),
		)
		const tool = cap.upserts.find((u) => u.type === "tool")
		expect(tool?.data.tool).toBe("plan-write")
		const meta = tool?.data.metadata as Record<string, unknown> | undefined
		expect(meta?.planPath).toBe(`.loop/plans/${SID}.md`)
		expect(typeof meta?.planContent).toBe("string")
		expect(meta?.planContent).toContain("# Plan")
		// And onPlanWritten must have fired so the runtime knows to
		// synthesize the plan-exit Part for PlanCard rendering.
		expect(planWrites).toHaveLength(1)
		expect(planWrites[0].planPath).toBe(`.loop/plans/${SID}.md`)
	})

	it("recognises plan-write via diff content block path (empty rawInput)", () => {
		// Cursor often emits Edit tool calls with empty rawInput and a
		// generic title like "Edited File" — the real path lives in the
		// `diff` content blocks. Adapter must detect plan-write from
		// `tool.content[].path` so the UI shows PlanCard, not "Edited File".
		const adapter = makeAdapter()
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-diff",
				title: "Edited File",
				kind: "edit",
				status: "completed",
				rawInput: {},
				content: [
					{
						type: "diff",
						path: `.loop/plans/${SID}.md`,
						oldText: null,
						newText: "# Smoke plan\n\nA tiny test plan.",
					},
				],
			}),
		)
		const tool = cap.upserts.find((u) => u.type === "tool")
		expect(tool?.data.tool).toBe("plan-write")
	})

	it("recognises plan-write via locations[] (empty rawInput, no diff)", () => {
		const adapter = makeAdapter()
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-loc",
				title: "Edited File",
				kind: "edit",
				status: "completed",
				rawInput: {},
				locations: [{ path: `.loop/plans/${SID}.md` }],
			}),
		)
		const tool = cap.upserts.find((u) => u.type === "tool")
		expect(tool?.data.tool).toBe("plan-write")
	})

	it("recognises plan-write via rawOutput.path", () => {
		const adapter = makeAdapter()
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-out",
				title: "Edited File",
				kind: "edit",
				status: "completed",
				rawInput: {},
				rawOutput: { path: `.loop/plans/${SID}.md`, bytesWritten: 256 },
			}),
		)
		const tool = cap.upserts.find((u) => u.type === "tool")
		expect(tool?.data.tool).toBe("plan-write")
	})

	it("does NOT match unrelated .md files", () => {
		const adapter = makeAdapter()
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-4",
				title: "Edit readme",
				kind: "edit",
				status: "completed",
				rawInput: { path: "README.md", content: "..." },
			}),
		)
		const tool = cap.upserts.find((u) => u.type === "tool")
		expect(tool?.data.tool).toBe("edit")
	})

	it("matches generic .loop/plans/<id>.md when sessionId is unknown", () => {
		const adapter = makeAdapter(undefined)
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-5",
				title: "Edit",
				kind: "edit",
				status: "completed",
				rawInput: { path: ".loop/plans/01ANOTHERSESSION.md", content: "x" },
			}),
		)
		const tool = cap.upserts.find((u) => u.type === "tool")
		expect(tool?.data.tool).toBe("plan-write")
	})

	it("recognises Cursor's CreatePlan tool by title (alias path)", () => {
		const adapter = makeAdapter()
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-6",
				title: "CreatePlan",
				kind: "edit",
				status: "completed",
				rawInput: { plan: "## My plan\nstep 1" },
			}),
		)
		const tool = cap.upserts.find((u) => u.type === "tool")
		expect(tool?.data.tool).toBe("plan-write")
		const meta = tool?.data.metadata as Record<string, unknown> | undefined
		expect(meta?.planContent).toBe("## My plan\nstep 1")
	})

	it("fires onPlanWritten once per completed plan write", () => {
		const adapter = makeAdapter()
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-7",
				title: "Edit plan",
				kind: "edit",
				status: "in_progress",
				rawInput: { path: `.loop/plans/${SID}.md`, content: "draft" },
			}),
		)
		expect(planWrites).toHaveLength(0) // not yet final
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call_update",
				toolCallId: "t-7",
				status: "completed",
			}),
		)
		expect(planWrites).toHaveLength(1)
		expect(planWrites[0].planPath).toBe(`.loop/plans/${SID}.md`)
		// Subsequent updates must not re-fire
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call_update",
				toolCallId: "t-7",
				status: "completed",
			}),
		)
		expect(planWrites).toHaveLength(1)
	})

	it("resets onPlanWritten state on beginTurn", () => {
		const adapter = makeAdapter()
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-8a",
				title: "Edit plan",
				kind: "edit",
				status: "completed",
				rawInput: { path: `.loop/plans/${SID}.md`, content: "v1" },
			}),
		)
		expect(planWrites).toHaveLength(1)

		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-8b",
				title: "Edit plan",
				kind: "edit",
				status: "completed",
				rawInput: { path: `.loop/plans/${SID}.md`, content: "v2" },
			}),
		)
		expect(planWrites).toHaveLength(2)
	})

	it("injectExternalPlanWrite emits a plan-write Part and fires onPlanWritten", () => {
		const adapter = makeAdapter()
		adapter.beginTurn(undefined)
		adapter.injectExternalPlanWrite({
			planPath: `.loop/plans/${SID}.md`,
			planContent: "# Plan via cursor/create_plan extension",
		})
		const tool = cap.upserts.find((u) => u.type === "tool")
		expect(tool?.data.tool).toBe("plan-write")
		expect((tool?.data.metadata as Record<string, unknown>)?.planContent).toBe(
			"# Plan via cursor/create_plan extension",
		)
		expect(planWrites).toHaveLength(1)
		expect(planWrites[0].planPath).toBe(`.loop/plans/${SID}.md`)
	})

	it("notifyPlanIfWritten is idempotent (drains once)", () => {
		const adapter = makeAdapter()
		adapter.beginTurn(undefined)
		adapter.handle(
			notif(SID, {
				sessionUpdate: "tool_call",
				toolCallId: "t-9",
				title: "Edit plan",
				kind: "edit",
				status: "completed",
				rawInput: { path: `.loop/plans/${SID}.md`, content: "x" },
			}),
		)
		// onPlanWritten already fired once during apply; calling drain returns
		// undefined because the pending was consumed.
		expect(adapter.notifyPlanIfWritten()).toBeUndefined()
	})
})

describe("Plan reminder text", () => {
	it("Cursor variant does NOT mention plan_write or plan_exit", async () => {
		const { buildCursorPlanReminder } = await import("../../server/agent/prompt/inject")
		const text = buildCursorPlanReminder(`.loop/plans/${SID}.md`, undefined)
		expect(text).not.toMatch(/plan_write/)
		expect(text).not.toMatch(/plan_exit/)
		expect(text).toMatch(/Plan mode is active/)
		expect(text).toMatch(/Edit, Write, or CreatePlan/)
		expect(text).toMatch(new RegExp(`${SID}\\.md`))
	})

	it("Cursor variant tells the model the host will surface a Plan card", async () => {
		const { buildCursorPlanReminder } = await import("../../server/agent/prompt/inject")
		const text = buildCursorPlanReminder(`.loop/plans/${SID}.md`, undefined)
		expect(text).toMatch(/Plan card/i)
		expect(text).toMatch(/Approve/)
	})

	it("default variant DOES still mention plan_write and plan_exit", async () => {
		const { buildPlanReminder } = await import("../../server/agent/prompt/inject")
		const text = buildPlanReminder(`.loop/plans/${SID}.md`, undefined)
		expect(text).toMatch(/plan_write/)
		expect(text).toMatch(/plan_exit/)
	})
})
