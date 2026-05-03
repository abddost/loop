import type { PermissionRule, PermissionRuleset } from "@core/schema/permission"
import { evaluate } from "../../permission/evaluate"

/**
 * Permission integration for Cursor SDK.
 *
 * The Cursor SDK doesn't expose a tool allowlist — built-in tools (Shell,
 * Read, Edit, Write, Glob, Grep, Ls, ...) are always available to the agent.
 * That means Loop's PermissionRuleset can't be enforced at the SDK boundary.
 *
 * Best we can do today: surface the active ruleset INSIDE the system prompt
 * so the agent itself knows which tools are off-limits. For an honest model
 * (Claude / GPT-5 / etc.) this is reliable enough; for safety-critical work
 * pair this with the workspace-level permission mode (full-access vs custom)
 * which is enforced by Loop's outer dispatcher.
 *
 * Cursor's `task` tool delegates to subagents whose prompts we control via
 * the inline `agents` config — those CAN be restricted properly because
 * each subagent's prompt is fully under our control. See `agents-config.ts`.
 */

/**
 * Cursor's built-in tool names mapped to the Loop permission categories that
 * gate them. A Cursor tool is considered "allowed" when at least one of its
 * mapped Loop permissions evaluates to allow / ask under the ruleset.
 *
 * Multiple Loop permissions can map to the same Cursor tool (e.g. Edit
 * covers Loop's `edit`, `multiedit`, `apply-patch`). When ANY of those is
 * unblocked we include the tool in the allowed set.
 */
const CURSOR_TOOL_TO_LOOP_PERMS: Record<string, readonly string[]> = {
	Read: ["read"],
	Glob: ["glob"],
	Grep: ["grep"],
	Ls: ["list"],
	SemSearch: ["grep", "semantic-search"],
	ReadLints: ["read"],
	Shell: ["bash"],
	Edit: ["edit", "multiedit", "apply-patch"],
	Write: ["write"],
	Delete: ["write"],
	UpdateTodos: ["todowrite"],
	CreatePlan: ["plan_write"],
	Task: ["task"],
	Mcp: ["mcp"],
}

export interface CursorPermissionSummary {
	/** Cursor tools the agent should USE freely. */
	allowed: string[]
	/** Cursor tools the agent should AVOID — paired with the rule that denied them. */
	denied: { tool: string; reason: string }[]
	/** Cursor tools that prompt the user before each call. */
	asks: string[]
}

export function summarizeCursorAccess(ruleset: PermissionRuleset): CursorPermissionSummary {
	const allowed: string[] = []
	const denied: { tool: string; reason: string }[] = []
	const asks: string[] = []

	for (const [cursorTool, loopPerms] of Object.entries(CURSOR_TOOL_TO_LOOP_PERMS)) {
		const verdicts = loopPerms.map((perm) => evaluate(perm, "*", ruleset))
		const hasAllow = verdicts.some((v) => v.action === "allow")
		const hasAsk = verdicts.some((v) => v.action === "ask")
		const allDeny = verdicts.every((v) => v.action === "deny")

		if (hasAllow) {
			allowed.push(cursorTool)
		} else if (hasAsk) {
			asks.push(cursorTool)
		} else if (allDeny) {
			const denyRule = findFirstMatchingDeny(loopPerms, ruleset)
			denied.push({
				tool: cursorTool,
				reason: denyRule
					? `${denyRule.permission}=${denyRule.pattern} → deny`
					: "denied by ruleset",
			})
		}
	}

	return { allowed, denied, asks }
}

function findFirstMatchingDeny(
	loopPerms: readonly string[],
	ruleset: PermissionRuleset,
): PermissionRule | undefined {
	for (const rule of ruleset) {
		if (rule.action !== "deny") continue
		for (const perm of loopPerms) {
			if (perm === rule.permission || rule.permission === "*") return rule
		}
	}
	return undefined
}

/**
 * Render the permission summary as a system-prompt section. Agents read this
 * and (in our experience) honor it. Returns an empty string when nothing is
 * restricted — no need to clutter the prompt for build-mode agents.
 */
export function renderCursorPermissionsBlock(
	summary: CursorPermissionSummary,
	agentName: string,
): string {
	if (summary.denied.length === 0 && summary.asks.length === 0) return ""

	const lines: string[] = ["<tool-policy>"]
	lines.push(`Active agent: ${agentName}`)
	if (summary.denied.length > 0) {
		lines.push("Forbidden tools (do NOT call these — they will fail or violate policy):")
		for (const d of summary.denied) {
			lines.push(`  - ${d.tool}: ${d.reason}`)
		}
	}
	if (summary.asks.length > 0) {
		lines.push("Prompt-the-user tools (the user will be asked to confirm each call):")
		for (const tool of summary.asks) lines.push(`  - ${tool}`)
	}
	if (summary.allowed.length > 0) {
		lines.push(`Allowed without prompt: ${summary.allowed.join(", ")}`)
	}
	lines.push("</tool-policy>")
	return lines.join("\n")
}
