import type { Deferred } from "@core/util/async"
import { Workspace } from "../workspace"

/**
 * Pending permission requests. Maps callId to a Deferred<boolean>.
 * Resolved when the user responds via POST /permissions/:callId.
 */
export const pendingPermissions = Workspace.state(
	() => new Map<string, Deferred<boolean>>(),
	(map) => {
		for (const [, d] of map) {
			if (!d.settled) d.reject(new Error("workspace disposed"))
		}
		map.clear()
	},
)

/** Known safe tools that never require user confirmation. */
const SAFE_TOOLS = new Set(["read", "glob", "grep", "list"])

/**
 * Check if a tool call is allowed by the current permission ruleset.
 * @returns true if allowed, false if denied, null if needs user confirmation.
 */
export function checkPermission(
	toolId: string,
	input: Record<string, unknown>,
	ruleset: {
		mode: string
		rules: Array<{ tool: string; allow: boolean; prefix?: string }>
	},
): boolean | null {
	// Allow-all mode: everything is permitted
	if (ruleset.mode === "allow-all") return true

	// Check explicit rules
	for (const rule of ruleset.rules) {
		if (rule.tool === toolId) {
			// For bash tool, check command prefix
			if (rule.prefix && toolId === "bash") {
				const command = String(input.command ?? "")
				if (command.startsWith(rule.prefix)) return rule.allow
				continue
			}
			return rule.allow
		}
	}

	// Ask-always mode: need confirmation for everything
	if (ruleset.mode === "ask-always") return null

	// Default mode: safe tools are auto-allowed, others need confirmation
	if (SAFE_TOOLS.has(toolId)) return true

	return null
}
