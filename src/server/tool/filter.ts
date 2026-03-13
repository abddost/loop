import type { ModelInfo } from "@core/schema/provider"
import type { Tool } from "./shape"

/**
 * Filter available tools based on agent permissions and model capabilities.
 * Returns only tools the given agent is allowed to use on the given model.
 */
export function filterTools(
	allTools: Tool.Shape[],
	agent: {
		name: string
		permission: {
			mode: string
			rules: Array<{ tool: string; allow: boolean }>
		}
	},
	modelInfo: ModelInfo,
): Tool.Shape[] {
	// If model doesn't support tools, return empty
	if (!modelInfo.supportsTools) return []

	return allTools.filter((tool) => {
		// Check agent permission rules for explicit denials
		const rule = agent.permission.rules.find((r) => r.tool === tool.id)
		if (rule && !rule.allow) return false

		return true
	})
}
