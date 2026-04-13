import type { PermissionRule, PermissionRuleset } from "./types"
import { Wildcard } from "./wildcard"

/**
 * Evaluate a permission request against one or more rulesets.
 *
 * Semantics:
 *   1. **Deny is absolute.** If any matching rule has action `deny`, the
 *      result is deny — no later `allow`/`ask` rule can override it. This
 *      prevents a narrow "always ok" session override from accidentally
 *      re-enabling a previously denied-by-policy action.
 *   2. Among non-deny matches, **last-match-wins**. Rules are checked in
 *      order; the last matching `allow`/`ask` determines the action. This
 *      lets general rules be narrowed by more specific ones later in the
 *      list.
 *   3. If no rule matches, default to `ask`.
 *
 * @param permission - The permission type (e.g., "bash", "edit")
 * @param pattern - The specific value (e.g., file path, command)
 * @param rulesets - One or more rulesets to evaluate (merged in order)
 * @returns The effective rule for this request.
 */
export function evaluate(
	permission: string,
	pattern: string,
	...rulesets: PermissionRuleset[]
): PermissionRule {
	const merged = rulesets.flat()
	const matches = merged.filter(
		(rule) => Wildcard.match(permission, rule.permission) && Wildcard.match(pattern, rule.pattern),
	)

	// Deny is absolute — return the first deny found so its pattern is preserved
	// in the returned rule (useful for error messages).
	const deny = matches.find((r) => r.action === "deny")
	if (deny) return deny

	// Among non-deny matches, last-match-wins.
	const last = matches[matches.length - 1]
	return last ?? { action: "ask", permission, pattern: "*" }
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
