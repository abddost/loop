import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { Agent } from "@core/schema/agent"
import { status as mcpStatus } from "../../mcp"
import { isCodexModel } from "../../provider/handlers/codex"
import { listForPrompt as skillsPrompt } from "../../skill"
import { Workspace } from "../../workspace"
import { PROMPT_AGENT } from "./templates/agent"
import { PROMPT_CODEX } from "./templates/codex"

/**
 * Assemble the complete system prompt in exact order:
 * 1. Model-specific header (PROMPT_CODEX for Codex models; short identity line otherwise)
 * 2. Agent instructions (agent.prompt if specialized, otherwise PROMPT_AGENT — always included
 *    so the full agentic workflow reaches every model, including Codex)
 * 3. Environment block
 * 4. AGENTS.md content (nearest, walking up to project root)
 * 5. CLAUDE.md content (nearest, walking up to project root)
 * 6. Available skills listing
 * 7. Connected MCP servers summary
 * 8. Request-level system override
 *
 * Note: No per-agent mode reminder here. Mode-specific behavior (plan/build) is
 * injected as a synthetic reminder on the last user message by insertReminders(),
 * where it is maximally salient to the model and doesn't vary the system prompt
 * across agent switches (preserving prompt cache hits).
 */
export async function assembleSystemPrompt(params: {
	agent: Agent
	modelId: string
	systemOverride?: string
}): Promise<string> {
	const parts: string[] = []

	// 1. Model-specific header. For Codex this is PROMPT_CODEX (Codex-tuned preamble);
	// for Claude/GPT/Gemini it's a short identity line.
	const header = getModelHeader(params.modelId)
	if (header) parts.push(header)

	// 2. Agent instructions.
	// Specialized agents (explore, title, summary, compaction, universal) define their own
	// prompt. Primary agents without one (build, plan) fall back to PROMPT_AGENT so that
	// build and plan produce an identical, stable system prompt — maximizing cache hits
	// across agent switches.
	const agentInstructions = params.agent.prompt ?? PROMPT_AGENT
	parts.push(agentInstructions)

	// 3. Environment block
	parts.push(buildEnvironmentBlock())

	// 4. AGENTS.md
	const agentsMd = findInstructionFile("AGENTS.md")
	if (agentsMd)
		parts.push(`<project-instructions source="AGENTS.md">\n${agentsMd}\n</project-instructions>`)

	// 5. CLAUDE.md
	const claudeMd = findInstructionFile("CLAUDE.md")
	if (claudeMd)
		parts.push(`<project-instructions source="CLAUDE.md">\n${claudeMd}\n</project-instructions>`)

	// 6. Available skills
	try {
		const skills = skillsPrompt()
		if (skills) parts.push(skills)
	} catch {
		// Skills may not be available (e.g. outside workspace context)
	}

	// 7. Connected MCP servers
	try {
		const mcpBlock = buildMcpBlock()
		if (mcpBlock) parts.push(mcpBlock)
	} catch {
		// MCP may not be initialized yet
	}

	// 8. Request-level override
	if (params.systemOverride) parts.push(params.systemOverride)

	return parts.filter(Boolean).join("\n\n")
}

/**
 * Builds an XML block listing connected MCP servers and their tool counts.
 * Helps the model understand which external tools are available.
 */
function buildMcpBlock(): string | undefined {
	const servers = mcpStatus()
	const connected = servers.filter((s) => s.status === "connected" && s.toolCount > 0)
	if (connected.length === 0) return undefined

	const lines = connected.map((s) => `<server name="${s.name}" tools="${s.toolCount}" />`)
	return `<mcp-servers>\n${lines.join("\n")}\n</mcp-servers>`
}

/**
 * Returns a model-specific preamble for known model families.
 * Helps models understand their capabilities and constraints.
 *
 * Codex models (ChatGPT-subscription OAuth endpoint) get the dedicated PROMPT_CODEX
 * preamble. The Codex check runs first because Codex model ids include "gpt" and
 * would otherwise match the generic OpenAI branch.
 */
function getModelHeader(modelId: string): string | undefined {
	if (isCodexModel(modelId)) {
		return PROMPT_CODEX
	}
	if (modelId.includes("claude")) {
		return "You are Claude, made by Anthropic. You are a helpful, harmless, and honest AI assistant."
	}
	if (modelId.includes("gpt")) {
		return "You are a helpful AI assistant powered by OpenAI."
	}
	if (modelId.includes("gemini")) {
		return "You are a helpful AI assistant powered by Google."
	}
	return undefined
}

/**
 * Builds an XML environment block with workspace metadata.
 * Includes working directory, platform, date, and git status.
 */
function buildEnvironmentBlock(): string {
	const dir = Workspace.dir()
	const platform = process.platform
	const date = new Date().toISOString().slice(0, 10)

	let isGitRepo = false
	try {
		isGitRepo = existsSync(resolve(dir, ".git"))
	} catch {
		// ignore
	}

	return `<env>
		Working directory: ${dir}
		Platform: ${platform}
		Date: ${date}
		Git repo: ${isGitRepo ? "yes" : "no"}
	</env>`
}

/**
 * Walk from the workspace directory upward to find the nearest instruction file.
 * Stops at the filesystem root. Deduplicates by resolved path to avoid reading
 * the same file if it appears at multiple levels.
 */
function findInstructionFile(filename: string): string | undefined {
	const seen = new Set<string>()
	let current = Workspace.dir()
	console.log("--------------------------------current---------------------", current)
	console.log("--------------------------------filename-----------------", filename)

	while (true) {
		const candidate = resolve(current, filename)
		if (!seen.has(candidate) && existsSync(candidate)) {
			seen.add(candidate)
			try {
				return readFileSync(candidate, "utf-8")
			} catch {
				return undefined
			}
		}

		const parent = dirname(current)
		if (parent === current) break
		current = parent
	}
	console.log("--------------------------------seen-----------------", seen)

	return undefined
}
