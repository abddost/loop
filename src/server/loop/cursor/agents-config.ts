import type { Agent } from "@core/schema/agent"
import { AgentRegistry } from "../../agent"

/**
 * NOT CURRENTLY WIRED.
 *
 * Passing inline `agents` to `Agent.create()` was empirically observed to
 * suppress Cursor's built-in tool execution (Read/Glob/Grep returned empty
 * results) — see commit history. Until the SDK supports inline subagent
 * declarations alongside its full built-in toolset we leave this helper as
 * scaffolding; Cursor's `task` tool falls back to its own internal subagent
 * registry. To re-enable, import + call `buildCursorAgentsConfig` inside
 * `session-runtime.ts::createOrResume` and pass the result to
 * `Agent.create` / `Agent.resume`.
 *
 * Translate Loop's built-in agents into the inline `agents` config Cursor's
 * SDK accepts on `Agent.create({ agents: { ... } })`. The SDK's built-in
 * `task` tool can then dispatch work to these subagents.
 *
 * Cursor's agent definition shape (per @cursor/sdk 1.0.11):
 *   {
 *     description: string,
 *     prompt: string,
 *     model?: ModelSelection | "inherit",
 *   }
 *
 * Caveat: Cursor's v1 cloud doesn't accept inline `mcpServers` on a
 * subagent — they always inherit the parent's MCP config. That's fine for
 * us; we register MCP at the parent level via `mcp-config.ts`.
 *
 * Why we translate only Loop's `subagent`-typed agents (explore, universal):
 *   - "primary" agents (build, plan) ARE the cursor agent itself — they
 *     don't need to be subagents.
 *   - "hidden" agents (compaction, title, summary) run via the AI-SDK loop
 *     in their own model contexts; they're not invocable from cursor's
 *     task tool.
 */

interface CursorAgentDefinition {
	description: string
	prompt: string
	model?: "inherit"
}

export function buildCursorAgentsConfig(): Record<string, CursorAgentDefinition> | undefined {
	const out: Record<string, CursorAgentDefinition> = {}
	for (const agent of AgentRegistry.list()) {
		if (agent.type !== "subagent") continue
		const def = toCursorAgentDefinition(agent)
		if (def) out[agent.name] = def
	}
	return Object.keys(out).length > 0 ? out : undefined
}

function toCursorAgentDefinition(agent: Agent): CursorAgentDefinition | undefined {
	const prompt = agent.prompt
	if (!prompt || !prompt.trim()) {
		// Cursor requires a non-empty prompt for subagents. Skip agents
		// without one rather than synthesizing — a missing persona produces
		// worse results than not exposing the subagent at all.
		return undefined
	}
	const description = agent.description ?? `${agent.name} subagent`
	return {
		description,
		prompt,
		model: "inherit",
	}
}
