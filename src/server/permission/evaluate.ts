import type { PermissionRule, PermissionRuleset } from "./types"
import { Wildcard } from "./wildcard"

/**
 * Evaluate a permission request against one or more rulesets.
 *
 * Uses **last-match-wins** semantics: rules are checked in order,
 * and the last matching rule determines the action. This allows
 * general rules to be overridden by more specific ones later.
 *
 * @param permission - The permission type (e.g., "bash", "edit")
 * @param pattern - The specific value (e.g., file path, command)
 * @param rulesets - One or more rulesets to evaluate (merged in order)
 * @returns The matching rule, or a default "ask" rule if no match
 */
export function evaluate(
	permission: string,
	pattern: string,
	...rulesets: PermissionRuleset[]
): PermissionRule {
	const merged = rulesets.flat()
	const match = merged.findLast(
		(rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
	)
	return match ?? { action: "ask", permission, pattern: "*" }
}

/**
 * Determine which tools are fully disabled (denied for all patterns).
 * Used by the tool filter to exclude tools from the AI SDK tool set.
 *
 * @param toolIds - Available tool IDs
 * @param ruleset - The active ruleset
 * @returns Set of tool IDs that are denied
 */
export function disabledTools(toolIds: string[], ruleset: PermissionRuleset): Set<string> {
	const result = new Set<string>()

	for (const toolId of toolIds) {
		const rule = ruleset.findLast((r) => Wildcard.match(toolId, r.permission))
		if (rule && rule.pattern === "*" && rule.action === "deny") {
			result.add(toolId)
		}
	}

	return result
}
