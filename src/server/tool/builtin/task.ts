import { ulid } from "@core/id"
import type { Agent } from "@core/schema/agent"
import type { PermissionRuleset } from "@core/schema/permission"
import { z } from "zod"
import { AgentRegistry } from "../../agent"
import * as queries from "../../db/queries"
import { createLogger } from "../../logger"
import { promptSession } from "../../loop/prompt"
import { cancelSession } from "../../loop/status"
import type { Tool } from "../shape"

const log = createLogger("task")

// ─── Task tool definition ───────────────────────────────────────

export const taskTool: Tool.Shape = {
	id: "task",
	init() {
		return {
			description: `Spawn a sub-agent to handle a specific task autonomously. The sub-agent runs in its own session with full streaming, tool access, and compaction support, returning the result when done.

Available subagent types:
- "build" (default): Full access to all tools. Use for implementing changes.
- "plan": Read-only. Can read the codebase and create plans but cannot modify files.
- "explore": Lightweight codebase exploration. Good for quick research.
- "universal": General-purpose agent with balanced capabilities.`,
			parameters: z.object({
				description: z
					.string()
					.describe("Short description (3-5 words) of what the subtask should accomplish"),
				prompt: z.string().describe("Detailed instructions for the sub-agent"),
				subagent_type: z
					.enum(["build", "plan", "explore", "universal"])
					.optional()
					.describe("Type of sub-agent to use (default: build)"),
			}),
			async execute(ctx, input) {
				const agentType = input.subagent_type ?? "build"

				await ctx.ask({
					permission: "task",
					patterns: [input.description],
					always: ["*"],
					metadata: {
						reason: `Spawn subtask (${agentType}): ${input.description}`,
						subagent_type: agentType,
					},
				})

				// Resolve agent definition
				const agent = AgentRegistry.get(agentType)
				if (!agent) {
					return { output: `Unknown agent type: ${agentType}` }
				}

				// Resolve model — prefer agent's own model, then parent context, then message fallback
				const modelRef = agent.model ?? ctx.modelRef ?? resolveParentModelRef(ctx.messages)
				if (!modelRef) {
					return { output: "No model configured for subagent or parent session" }
				}

				// Create child session in DB
				const parentSession = queries.findSessionById(ctx.sessionId)
				if (!parentSession) {
					return { output: "Parent session not found" }
				}

				const childSessionId = ulid()
				queries.createSession({
					id: childSessionId,
					projectId: parentSession.projectId,
					directory: parentSession.directory,
					parentId: ctx.sessionId,
					title: input.description,
					permission: buildSubagentRuleset(agent),
				})

				// Bail early if parent was already cancelled
				if (ctx.signal.aborted) {
					return { output: "Task cancelled before subagent started" }
				}

				// Wire parent→child cancellation (OpenCode pattern):
				// When parent is cancelled, cancel the child session.
				// promptSession() owns the child's lifecycle — we just link signals.
				const onParentAbort = () => cancelSession(childSessionId)
				ctx.signal.addEventListener("abort", onParentAbort, { once: true })

				try {
					// promptSession() handles EVERYTHING:
					// - Creates abort controller + registers in sessionStates()
					// - Creates user message with prompt text
					// - Runs runLoop() (full streaming, tools, compaction, retries)
					// - Cleans up state on exit (success or error)
					await promptSession(childSessionId, {
						text: input.prompt,
						model: modelRef,
						agent: agentType,
					})
				} catch (err) {
					// promptSession persists errors as assistant messages in the child session.
					// Log but don't re-throw — we still want to return the partial result.
					log.warn("Subagent session error", {
						childSessionId,
						error: err instanceof Error ? err.message : String(err),
					})
				} finally {
					ctx.signal.removeEventListener("abort", onParentAbort)
				}

				// Extract results from the child session
				const childMessages = queries.findMessagesBySessionId(childSessionId)
				const { text, toolCount, errorCount } = extractSubagentResult(childMessages)

				const title =
					toolCount > 0
						? `${capitalize(agentType)} ${toolCount} tool${toolCount !== 1 ? "s" : ""}`
						: capitalize(agentType)

				// Update parent tool metadata with child session reference
				ctx.metadata({
					metadata: {
						childSessionId,
						agentType,
						toolCount,
						errorCount,
					},
				})

				return {
					output: text || "(No output from subagent)",
					metadata: {
						childSessionId,
						agentType,
						title,
						toolCount,
						errorCount,
					},
				}
			},
		}
	},
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Build a ruleset for the subagent that auto-allows tools the agent permits
 * and denies tools the agent restricts. No user prompts for "ask" tools —
 * subagents should run autonomously without blocking on permission dialogs.
 */
function buildSubagentRuleset(agent: Agent): PermissionRuleset {
	// Start with the agent's own permission rules
	const rules: PermissionRuleset = [...agent.permission]

	// Override: auto-allow all tools that aren't explicitly denied.
	// Subagents run autonomously — they shouldn't prompt the user.
	// Tools explicitly denied in agent.permission remain denied.
	rules.unshift({ permission: "*", pattern: "*", action: "allow" })

	// Always deny task tool to prevent recursive subagent spawning
	rules.push({ permission: "task", pattern: "*", action: "deny" })

	// Always deny plan tools (subagents don't switch modes)
	rules.push({ permission: "plan_enter", pattern: "*", action: "deny" })
	rules.push({ permission: "plan_exit", pattern: "*", action: "deny" })

	// Always deny todo tools (subagents don't manage todos)
	rules.push({ permission: "todowrite", pattern: "*", action: "deny" })
	rules.push({ permission: "todoread", pattern: "*", action: "deny" })

	return rules
}

/**
 * Extract the model reference from the parent session's messages.
 * Looks at the last assistant message's metadata for modelId/providerId.
 */
function resolveParentModelRef(
	messages: any[],
): { modelId: string; providerId: string } | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		const meta = msg?.metadata as { modelId?: string; providerId?: string } | undefined
		if (meta?.modelId) {
			const providerId = meta.providerId ?? extractProviderId(meta.modelId)
			if (providerId) {
				return { modelId: meta.modelId, providerId }
			}
		}
	}
	return undefined
}

/** Extract provider ID from a model ID (e.g., "claude-3-5-sonnet" → "anthropic"). */
function extractProviderId(modelId: string): string | undefined {
	if (modelId.includes("claude")) return "anthropic"
	if (
		modelId.includes("gpt") ||
		modelId.includes("o1") ||
		modelId.includes("o3") ||
		modelId.includes("o4")
	)
		return "openai"
	if (modelId.includes("gemini")) return "google"
	return undefined
}

/**
 * Extract the final text and tool stats from a child session's messages.
 */
function extractSubagentResult(messages: queries.MessageWithParts[]): {
	text: string
	toolCount: number
	errorCount: number
} {
	let text = ""
	let toolCount = 0
	let errorCount = 0

	// Find the last assistant message's text
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.role === "assistant") {
			for (const part of msg.parts) {
				const data = (part.data ?? part) as Record<string, unknown>
				if (data.type === "text" && typeof data.text === "string") {
					text = data.text
				}
			}
			if (text) break
		}
	}

	// Count tool parts across all assistant messages
	for (const msg of messages) {
		if (msg.role !== "assistant") continue
		for (const part of msg.parts) {
			const data = (part.data ?? part) as Record<string, unknown>
			if (data.type === "tool") {
				toolCount++
				if (data.state === "error") errorCount++
			}
		}
	}

	return { text, toolCount, errorCount }
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1)
}
