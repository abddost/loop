import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import type { Agent } from "@core/schema/agent"
import { status as mcpStatus } from "../../mcp"
import { listForPrompt as skillsPrompt } from "../../skill"
import { Workspace } from "../../workspace"
import { getModeReminder } from "./inject"

/**
 * Assemble the complete system prompt in exact order:
 * 1. Model-specific header
 * 2. Agent prompt
 * 3. Environment block
 * 4. AGENTS.md content (nearest, walking up to project root)
 * 5. CLAUDE.md content (nearest, walking up to project root)
 * 6. Available skills listing
 * 7. Connected MCP servers summary
 * 8. Request-level system override
 * 9. Active mode reminder (plan/build switch)
 */
export async function assembleSystemPrompt(params: {
	agent: Agent
	modelId: string
	systemOverride?: string
	activeMode?: "plan" | "build"
}): Promise<string> {
	const parts: string[] = []

	// 1. Model-specific header
	const header = getModelHeader(params.modelId)
	if (header) parts.push(header)

	// 2. Agent prompt
	if (params.agent.prompt) parts.push(params.agent.prompt)

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

	// 9. Active mode reminder
	if (params.activeMode) parts.push(getModeReminder(params.activeMode))

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
 */
function getModelHeader(modelId: string): string | undefined {
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

	return undefined
}
