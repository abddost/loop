import { createHash } from "node:crypto"
import type { Agent } from "@core/schema/agent"
import type { PermissionRuleset } from "@core/schema/permission"
import { assembleSystemPrompt } from "../../agent/prompt/system"
import { renderCursorPermissionsBlock, summarizeCursorAccess } from "./permissions"

/**
 * Cursor-specific system prompt assembly.
 *
 * Wraps Loop's standard `assembleSystemPrompt` (model header → agent
 * instructions → environment → AGENTS.md → CLAUDE.md → skills → MCP) and
 * appends a tool-policy block derived from the active permission ruleset.
 *
 * Cursor's SDKAgent retains conversation context across `agent.send()` calls,
 * so the system prompt is "anchored" once and re-injecting it on every turn
 * would just bloat tokens. We expose `assembleCursorSystemPrompt()` for the
 * initial anchor + agent/model/ruleset changes, plus `cursorPromptSignature()`
 * so the runtime can detect when re-anchoring is needed.
 */

export interface AssembleCursorSystemPromptArgs {
	agent: Agent
	modelId: string
	ruleset: PermissionRuleset
}

export async function assembleCursorSystemPrompt(
	args: AssembleCursorSystemPromptArgs,
): Promise<string> {
	const base = await assembleSystemPrompt({
		agent: args.agent,
		modelId: args.modelId,
		systemOverride: undefined,
	})
	const policy = renderCursorPermissionsBlock(summarizeCursorAccess(args.ruleset), args.agent.name)
	return policy ? `${base}\n\n${policy}` : base
}

/**
 * Stable signature for the inputs that drive system-prompt content.
 * Re-anchor the SDKAgent whenever this changes.
 *
 * Includes:
 *   - agent name (different agent → different persona/permissions)
 *   - model id (model header differs across providers)
 *   - ruleset hash (custom session rules → different forbidden tools)
 */
export function cursorPromptSignature(args: AssembleCursorSystemPromptArgs): string {
	const rulesetKey = createHash("sha256")
		.update(JSON.stringify(args.ruleset))
		.digest("hex")
		.slice(0, 16)
	return `${args.agent.name}|${args.modelId}|${rulesetKey}`
}
