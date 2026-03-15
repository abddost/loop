import type { PermissionRuleset } from "@core/schema/permission"
import type { ModelInfo } from "@core/schema/provider"
import { disabledTools } from "../permission/evaluate"
import type { Tool } from "./shape"

/**
 * Filter tools based on permissions and model capabilities.
 * Uses the PermissionRuleset to determine which tools are fully denied.
 */
export function filterTools(
	allTools: Tool.Shape[],
	ruleset: PermissionRuleset,
	modelInfo: ModelInfo,
): Tool.Shape[] {
	if (!modelInfo.supportsTools) return []

	const disabled = disabledTools(
		allTools.map((t) => t.id),
		ruleset,
	)

	return allTools.filter((tool) => !disabled.has(tool.id))
}
