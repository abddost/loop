import { describe, expect, it } from "vitest"
import type { SessionMode } from "../../server/loop/cursor/acp/types"
import {
	_pickAutoApprovalOptionIdForTesting as pickAutoApproval,
	_resolveRequestedAcpModeForTesting as resolveMode,
} from "../../server/loop/cursor/runtime"

/**
 * Tests for the ACP mode resolver — pins the t3code-aligned alias buckets:
 *   plan      → ["plan", "architect"]
 *   implement → ["code", "agent", "default", "chat", "implement", "build"]
 *   approval  → ["ask"]
 *
 * "ask" must NOT be picked when the agent is "plan" — that's the
 * critical bug from the prior implementation that confused tool routing.
 */

const planMode = (id: string, dn?: string): SessionMode => ({ id, displayName: dn ?? id })

describe("resolveRequestedAcpMode", () => {
	const standard: SessionMode[] = [
		planMode("plan", "Plan"),
		planMode("default", "Build"),
		planMode("ask", "Ask"),
	]

	it("plan agent → plan mode", () => {
		const m = resolveMode({
			agentName: "plan",
			sessionPermissionMode: undefined,
			available: standard,
		})
		expect(m?.id).toBe("plan")
	})

	it("explore agent → plan mode (alias bucket)", () => {
		const m = resolveMode({
			agentName: "explore",
			sessionPermissionMode: undefined,
			available: standard,
		})
		expect(m?.id).toBe("plan")
	})

	it("build agent → default (implement)", () => {
		const m = resolveMode({
			agentName: "build",
			sessionPermissionMode: undefined,
			available: standard,
		})
		expect(m?.id).toBe("default")
	})

	it("sessionPermissionMode='plan' → plan mode for ANY agent", () => {
		// Critical: clicking "Plan mode" in the UI sets sessionPermissionMode.
		// Without this, the toggle would silently do nothing for cursor.
		const m = resolveMode({
			agentName: "build",
			sessionPermissionMode: "plan",
			available: standard,
		})
		expect(m?.id).toBe("plan")
	})

	it("sessionPermissionMode='plan' wins over implement even when build agent is active", () => {
		const m = resolveMode({
			agentName: "build",
			sessionPermissionMode: "plan",
			available: [planMode("default"), planMode("plan")],
		})
		expect(m?.id).toBe("plan")
	})

	it("plan agent does NOT pick 'ask' even when offered", () => {
		// Critical regression: previously `["plan", "architect", "ask"]` would
		// fall back to "ask" if the agent didn't expose "plan"/"architect".
		const onlyAskAndDefault: SessionMode[] = [planMode("default"), planMode("ask")]
		const m = resolveMode({
			agentName: "plan",
			sessionPermissionMode: undefined,
			available: onlyAskAndDefault,
		})
		// Plan-aliases didn't match. We should NOT silently pick "ask"; we
		// should pick nothing (so the caller leaves whatever Cursor's default
		// mode is alone) OR fall through. Either way, NOT "ask".
		expect(m?.id).not.toBe("ask")
	})

	it("approval-required permission mode → ask", () => {
		const m = resolveMode({
			agentName: "build",
			sessionPermissionMode: "approval-required",
			available: standard,
		})
		expect(m?.id).toBe("ask")
	})

	it("falls back to implement when approval mode unavailable", () => {
		const noAsk: SessionMode[] = [planMode("plan"), planMode("default")]
		const m = resolveMode({
			agentName: "build",
			sessionPermissionMode: "approval-required",
			available: noAsk,
		})
		expect(m?.id).toBe("default")
	})

	it("matches by displayName when id doesn't match", () => {
		const fancy: SessionMode[] = [planMode("mode-a", "Plan"), planMode("mode-b", "Code")]
		const m = resolveMode({ agentName: "plan", sessionPermissionMode: undefined, available: fancy })
		expect(m?.id).toBe("mode-a")
	})

	it("returns undefined when no modes are advertised", () => {
		const m = resolveMode({
			agentName: "plan",
			sessionPermissionMode: undefined,
			available: [],
		})
		expect(m).toBeUndefined()
	})

	it("matches 'architect' as a plan alias (Cursor's planner mode)", () => {
		const arch: SessionMode[] = [planMode("default"), planMode("architect", "Architect")]
		const m = resolveMode({
			agentName: "plan",
			sessionPermissionMode: undefined,
			available: arch,
		})
		expect(m?.id).toBe("architect")
	})

	it("matches 'agent' as an implement alias", () => {
		const ag: SessionMode[] = [planMode("plan"), planMode("agent", "Agent")]
		const m = resolveMode({
			agentName: "build",
			sessionPermissionMode: undefined,
			available: ag,
		})
		expect(m?.id).toBe("agent")
	})
})

describe("pickAutoApprovalOptionId", () => {
	it("prefers allow_always over allow_once", () => {
		const optionId = pickAutoApproval([
			{ optionId: "ao", kind: "allow_once" },
			{ optionId: "aa", kind: "allow_always" },
			{ optionId: "ro", kind: "reject_once" },
		])
		expect(optionId).toBe("aa")
	})

	it("falls back to allow_once when allow_always is missing", () => {
		const optionId = pickAutoApproval([
			{ optionId: "ao", kind: "allow_once" },
			{ optionId: "ro", kind: "reject_once" },
		])
		expect(optionId).toBe("ao")
	})

	it("returns undefined when no allow option is offered", () => {
		const optionId = pickAutoApproval([
			{ optionId: "ro", kind: "reject_once" },
			{ optionId: "ra", kind: "reject_always" },
		])
		expect(optionId).toBeUndefined()
	})

	it("trims surrounding whitespace from optionId", () => {
		const optionId = pickAutoApproval([{ optionId: "  aa  ", kind: "allow_always" }])
		expect(optionId).toBe("aa")
	})
})
