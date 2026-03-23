import type { PermissionConfig, PermissionRuleset } from "./types"

/**
 * Convert a PermissionConfig (from config file or agent definition)
 * into a flat PermissionRuleset (array of rules).
 *
 * @param config - Permission config block
 * @returns Flat ruleset
 */
export function fromConfig(config: PermissionConfig): PermissionRuleset {
	const ruleset: PermissionRuleset = []

	for (const [key, value] of Object.entries(config)) {
		if (typeof value === "string") {
			// Simple action: "bash": "allow"
			ruleset.push({ permission: key, pattern: "*", action: value })
		} else if (typeof value === "object" && value !== null) {
			// Pattern-based: "edit": { "*": "ask", "src/**": "allow" }
			for (const [pattern, action] of Object.entries(value)) {
				ruleset.push({ permission: key, pattern, action })
			}
		}
	}

	return ruleset
}

/**
 * Merge multiple rulesets into one. Order matters — later rules override earlier ones.
 */
export function merge(...rulesets: PermissionRuleset[]): PermissionRuleset {
	return rulesets.flat()
}

// ────────────────────────────────────────────────────────────
// Global defaults — applied to all agents before agent-specific overrides.
// Read-only tools are always allowed. Dangerous tools default to "ask".
// ────────────────────────────────────────────────────────────

const GLOBAL_DEFAULTS: PermissionConfig = {
	"*": "allow", // everything allowed by default
	doom_loop: "ask", // always ask on doom loop detection
	read: "allow",
	glob: "allow",
	grep: "allow",
	list: "allow",
	bash: "ask",
	edit: "ask",
	write: "ask",
	task: "ask",
	"web-fetch": "ask",
	"web-search": "ask",
}

/** Full-access ruleset — everything allowed, no prompts. */
const FULL_ACCESS: PermissionConfig = {
	"*": "allow",
	doom_loop: "ask", // still ask on doom loops for safety
}

/**
 * Build the complete ruleset for an agent.
 * Merge order: global defaults → agent permission → user config → session overrides.
 * Last-match-wins ensures user config can override everything.
 *
 * @param agentPermission - The agent's permission ruleset (from agent definition)
 * @param userConfig - User's permission config (from config file/settings)
 * @param sessionOverride - Optional session-level ruleset override
 * @returns Merged flat ruleset
 */
export function buildAgentRuleset(
	agentPermission: PermissionRuleset,
	userConfig?: PermissionConfig,
	sessionOverride?: PermissionRuleset,
): PermissionRuleset {
	const defaults = fromConfig(GLOBAL_DEFAULTS)
	const user = userConfig ? fromConfig(userConfig) : []
	const session = sessionOverride ?? []

	return merge(defaults, agentPermission, user, session)
}

/**
 * Build a full-access ruleset (for "Full Access" mode).
 * Still respects doom loop detection for safety.
 */
export function buildFullAccessRuleset(): PermissionRuleset {
	return fromConfig(FULL_ACCESS)
}
