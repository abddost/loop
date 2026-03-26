import { ulid } from "@core/id"
import { filterCompacted } from "@core/message/compact"
import { toModelMessages } from "@core/message/convert"
import type { MessageWithParts } from "@core/schema/message"
import { tool as aiTool } from "ai"
import { AgentRegistry } from "../agent"
import { insertReminders } from "../agent/prompt/inject"
import { assembleSystemPrompt } from "../agent/prompt/system"
import * as Config from "../config"
import * as Database from "../db"
import * as queries from "../db/queries"
import { createLogger } from "../logger"
import { allMcpTools } from "../mcp"
import { resolveRuleset } from "../permission"
import { ProviderRegistry, streamWithRetry } from "../provider"
import { filterTools } from "../tool/filter"
import { ToolRegistry } from "../tool/registry"
import type { Tool } from "../tool/shape"
import { bus } from "../workspace/bus"
import {
	COMPACTION_BUFFER,
	COMPACTION_USER_PROMPT,
	estimateMessageTokens,
	needsCompaction,
	pruneToolOutputs,
	runCompaction,
	truncateForCompaction,
} from "./compaction"
import { setSessionStatus } from "./status"
import { processStream } from "./stream-processor"
import { generateTitle } from "./title"

const log = createLogger("loop")

export interface PromptBody {
	messageId?: string
	text?: string
	files?: Array<{ path: string; mimeType: string; content: string }>
	model?: { modelId: string; providerId: string }
	agent?: string
	option?: string
	synthetic?: boolean
	tools?: Record<string, boolean>
	reasoningEffort?: "low" | "medium" | "high" | "xhigh"
}

interface IterationDecision {
	type: "done" | "compact" | "continue"
	reminders?: string[]
}

/** Regex for detecting resume/continue intent. */
const RESUME_PATTERN = /^(resume|continue|try again|keep going|go ahead)$/i

/**
 * Resolve the iteration decision for the agentic loop.
 * Examines the last messages to determine whether the loop should continue,
 * compact, or stop.
 */
function resolveIteration(
	messages: MessageWithParts[],
	totalTokens: number,
	contextWindow: number,
	maxOutput: number,
): IterationDecision {
	if (messages.length === 0) return { type: "continue" }

	// Check context overflow
	if (needsCompaction(totalTokens, contextWindow, maxOutput)) {
		return { type: "compact" }
	}

	const lastMessage = messages[messages.length - 1]

	// If last message is user, check for resume/continue intent
	if (lastMessage.role === "user") {
		const textParts = lastMessage.parts.filter((p) => p.type === "text")
		const text = textParts
			.map((p) => ("text" in p ? p.text : ""))
			.join(" ")
			.trim()

		if (RESUME_PATTERN.test(text)) {
			return { type: "continue", reminders: ["resume"] }
		}

		return { type: "continue" }
	}

	// If last message is assistant, check finish state
	if (lastMessage.role === "assistant") {
		const meta = lastMessage.metadata as { finish?: string } | undefined

		// Unfinished assistant message — continue
		if (!meta?.finish) return { type: "continue" }

		// Check if there are tool calls that need continuation
		const hasToolCalls = lastMessage.parts.some(
			(p) => p.type === "tool" && (p as any).state === "completed",
		)

		// If the assistant finished with tool calls, it may need another turn
		if (meta.finish === "tool-calls" || hasToolCalls) {
			return { type: "continue" }
		}

		// Assistant finished cleanly with "stop"
		if (meta.finish === "stop") {
			return { type: "done" }
		}

		// Length finish — context is full, try compaction
		if (meta.finish === "length") {
			return { type: "compact" }
		}
	}

	return { type: "done" }
}

/**
 * Build the tool set for the current agent and model.
 * Filters tools based on permissions and model capabilities,
 * then initializes each tool's definition.
 */
function buildToolSet(
	allTools: Tool.Shape[],
	agentName: string,
	ruleset: import("@core/schema/permission").PermissionRuleset,
	modelInfo: { supportsTools: boolean },
): Map<string, { shape: Tool.Shape; definition: Tool.ToolDefinition }> {
	const filtered = filterTools(allTools, ruleset, modelInfo as any)
	const result = new Map<string, { shape: Tool.Shape; definition: Tool.ToolDefinition }>()

	for (const shape of filtered) {
		const definition = shape.init(agentName)
		result.set(shape.id, { shape, definition })
	}

	return result
}

/**
 * Determine the current agent name from the message history.
 * Reads from the last user message's metadata, falling back to the prompt body
 * and then to "build" as the default.
 */
function resolveAgentName(messages: MessageWithParts[], body?: PromptBody): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg.role === "user") {
			const meta = msg.metadata as { agent?: string } | undefined
			if (meta?.agent) return meta.agent
			break
		}
	}
	return body?.agent ?? "build"
}

/**
 * Run the compaction flow: invoke the compaction agent, collect its summary,
 * and persist the compaction boundary.
 *
 * Appends the structured COMPACTION_USER_PROMPT as a user message to guide
 * the compaction agent's summary generation.
 *
 * @returns true if compaction succeeded, false if it failed
 */
async function executeCompaction(
	sessionId: string,
	_messages: MessageWithParts[],
	resolved: Awaited<ReturnType<typeof ProviderRegistry.resolveModel>>,
	signal: AbortSignal,
	overflow?: boolean,
): Promise<boolean> {
	setSessionStatus(sessionId, "compacting")

	const compactionAgent = AgentRegistry.get("compaction")
	if (!compactionAgent) {
		log.error("Compaction agent not found, stopping loop", { sessionId })
		return false
	}

	// Prune oversized tool outputs BEFORE compaction to prevent the
	// compaction agent itself from hitting context limits.
	await pruneToolOutputs(sessionId)

	// Reload messages after pruning so the compaction agent sees pruned content.
	const prunedMessages = filterCompacted(
		queries.findMessagesBySessionId(sessionId) as any,
	) as any as MessageWithParts[]

	// Emergency truncation: if pruned messages still exceed the compaction
	// agent's context budget, drop oldest messages to fit.
	const compactionBudget = resolved.info.contextWindow - resolved.info.maxOutput - COMPACTION_BUFFER
	const compactionMessages =
		estimateMessageTokens(prunedMessages) > compactionBudget
			? truncateForCompaction(prunedMessages, compactionBudget)
			: prunedMessages

	const compactionPrompt = await assembleSystemPrompt({
		agent: compactionAgent,
		modelId: resolved.info.id,
	})

	const coreMessages = toModelMessages(compactionMessages)

	// Append the structured compaction template as a user message
	// so the compaction agent generates a well-structured summary
	coreMessages.push({ role: "user", content: COMPACTION_USER_PROMPT })

	const compactionStream = await streamWithRetry(
		{
			model: resolved.instance,
			system: compactionPrompt,
			messages: coreMessages,
			temperature: compactionAgent.temperature ?? 0,
			maxOutputTokens: resolved.info.maxOutput,
		},
		signal,
	)

	// Collect the compaction summary
	let summaryText = ""
	for await (const chunk of compactionStream.fullStream) {
		if (signal.aborted) break
		if (chunk.type === "text-delta") {
			summaryText += chunk.text
		}
	}

	// Use the full pruned messages (not truncated) for runCompaction so
	// that the replay/continuation logic has accurate message history.
	const compactionResult = await runCompaction({
		sessionId,
		messages: prunedMessages,
		summary: summaryText,
		signal,
		overflow,
	})

	if (!compactionResult.success) {
		log.error("Compaction failed", { sessionId, error: compactionResult.error })
		return false
	}

	return true
}

/**
 * The core agentic loop. Runs as fire-and-forget from the prompt handler.
 * Inherits workspace context from ALS.
 *
 * Loop skeleton:
 * 1. Load session
 * 2. Load messages+parts, filterCompacted(), post-compaction only
 * 3. Resolve agent from last user message metadata (per-iteration)
 * 4. Resolve model and permission ruleset (per-iteration)
 * 5. Resolve iteration decision (done/compact/continue)
 * 6. Assemble system prompt (9-step order)
 * 7. Insert agent-specific reminders (in-memory only)
 * 8. Convert to CoreMessage[] via toModelMessages()
 * 9. Build tool set (filter by agent + model)
 * 10. Create stream factory for processStream (retry handled inside)
 * 11. Process stream events
 * 12. Handle compaction signals from stream processor
 * 13. Detect agent switches via synthetic user messages
 * 14. Check finish reason: break on "stop", continue on "tool-calls"
 *
 * @param sessionId - Session to run the loop for
 * @param signal - AbortSignal for cancellation
 * @param body - Optional prompt body with model/agent overrides
 */
export async function runLoop(
	sessionId: string,
	signal: AbortSignal,
	body?: PromptBody,
): Promise<void> {
	// 1. Load session
	const session = queries.findSessionById(sessionId)
	if (!session) throw new Error(`Session not found: ${sessionId}`)

	// Session-level permission state (constant across iterations)
	const sessionPermissionMode = (session.permissionMode as string) ?? "default"
	const sessionRuleset = Array.isArray(session.permission)
		? (session.permission as import("@core/schema/permission").PermissionRuleset)
		: undefined

	// Model reference from the prompt body (used as the initial default)
	const bodyModelRef = body?.model

	const maxStepsDefault = 100
	let stepCount = 0
	let totalTokens = 0

	// Track the last model ref used, so title generation can reference it after the loop
	let lastModelRef: { modelId: string; providerId: string } | undefined = bodyModelRef

	while (!signal.aborted) {
		stepCount++

		// 2. Load messages+parts, filter by compaction boundary
		const rawMessages = queries.findMessagesBySessionId(sessionId)
		const messages = filterCompacted(rawMessages as any) as any as MessageWithParts[]

		// 3. Resolve agent from last user message metadata (re-evaluated each iteration)
		const agentName = resolveAgentName(messages, body)
		const agent = AgentRegistry.get(agentName)
		if (!agent) throw new Error(`Agent not found: ${agentName}`)

		const maxSteps = agent.steps ?? maxStepsDefault
		if (stepCount > maxSteps) {
			log.warn("Max steps reached", { sessionId, maxSteps })
			break
		}

		// 4. Resolve model and permission ruleset for the current agent
		const modelRef = bodyModelRef ?? agent.model
		if (!modelRef) throw new Error("No model specified in prompt body or agent configuration")
		lastModelRef = modelRef

		const resolved = await ProviderRegistry.resolveModel(modelRef.providerId, modelRef.modelId)
		const ruleset = resolveRuleset(agent.permission, sessionPermissionMode, sessionRuleset)

		// 5. Resolve iteration decision
		const decision = resolveIteration(
			messages,
			totalTokens,
			resolved.info.contextWindow,
			resolved.info.maxOutput,
		)

		if (decision.type === "done") break

		if (decision.type === "compact") {
			const ok = await executeCompaction(sessionId, messages, resolved, signal)
			if (!ok) break

			totalTokens = 0
			continue
		}

		// 6. Assemble system prompt (9-step order)
		const systemPrompt = await assembleSystemPrompt({
			agent,
			modelId: resolved.info.id,
			systemOverride: undefined,
			activeMode: agentName === "plan" ? "plan" : agentName === "build" ? "build" : undefined,
		})

		// 7. Insert agent-specific reminders into messages (in-memory only)
		insertReminders({ messages, agent, sessionId })

		// 8. Convert to ModelMessage[]
		const coreMessages = toModelMessages(messages)

		// Debug: log messages for schema validation debugging
		if (stepCount > 1) {
			log.debug("Multi-step messages", {
				sessionId,
				step: stepCount,
				messageCount: coreMessages.length,
				snapshot: JSON.stringify(coreMessages, null, 2).slice(0, 3000),
			})
		}

		// 9. Build tool set (builtins + MCP tools)
		const toolSet = buildToolSet(ToolRegistry.all(), agentName, ruleset, resolved.info)

		// Merge MCP tools from connected servers
		try {
			const mcpTools = allMcpTools()
			const mcpFiltered = filterTools(mcpTools, ruleset, resolved.info)
			for (const shape of mcpFiltered) {
				const definition = shape.init(agentName)
				toolSet.set(shape.id, { shape, definition })
			}
		} catch (err) {
			log.warn("Failed to load MCP tools", { sessionId, error: err })
		}

		// Convert tool set to AI SDK format (no execute — we handle execution in processStream)
		const aiTools: Record<string, any> = {}
		for (const [name, entry] of toolSet) {
			aiTools[name] = aiTool({
				description: entry.definition.description,
				inputSchema: entry.definition.parameters,
			})
		}

		// 10. Create assistant message (with agent tracking)
		const assistantMessageId = ulid()
		const assistantMeta = {
			modelId: resolved.info.id,
			providerId: modelRef.providerId,
			agent: agentName,
		}
		Database.withEffects((_tx, effect) => {
			queries.createMessage({
				id: assistantMessageId,
				sessionId,
				role: "assistant",
				metadata: assistantMeta,
			})

			effect(() => {
				bus().emit("message:create", {
					sessionId,
					message: {
						id: assistantMessageId,
						sessionId,
						role: "assistant",
						metadata: assistantMeta,
						createdAt: Date.now(),
						updatedAt: Date.now(),
						parts: [],
					},
				})
			})
		})

		// 11. Stream with retry (stream creation + retry handled inside processStream)
		setSessionStatus(sessionId, "busy")

		// Resolve reasoning effort for reasoning-capable models
		const reasoningEffort = resolved.info.supportsReasoning
			? (body?.reasoningEffort ?? Config.read().reasoning?.effort ?? "medium")
			: undefined

		const streamParams = {
			model: resolved.instance,
			system: systemPrompt,
			messages: coreMessages,
			tools: Object.keys(aiTools).length > 0 ? aiTools : undefined,
			temperature: agent.temperature,
			topP: agent.topP,
			maxOutputTokens: resolved.info.maxOutput,
			...(reasoningEffort && {
				providerOptions: { openai: { reasoningEffort } },
			}),
		}

		const result = await processStream({
			sessionId,
			messageId: assistantMessageId,
			createStream: () => streamWithRetry(streamParams, signal),
			signal,
			agent: agentName,
			tools: toolSet,
			ruleset,
			messages: rawMessages as any,
			modelRef,
			pricing: resolved.info.pricing,
			contextWindow: resolved.info.contextWindow,
			maxOutput: resolved.info.maxOutput,
			onStepFinish: (usage) => {
				totalTokens += (usage.input ?? 0) + (usage.output ?? 0) + (usage.reasoning ?? 0)
			},
		})

		// Update assistant message with finish reason (preserve agent tracking)
		queries.updateMessage(assistantMessageId, {
			metadata: {
				modelId: resolved.info.id,
				providerId: modelRef.providerId,
				finish: result.finishReason,
				agent: agentName,
			},
		})

		// 12. Handle compaction signal from stream processor
		if (result.needsCompaction) {
			const overflow = !result.finishReason || result.finishReason === "length"
			const reloadedMessages = filterCompacted(
				queries.findMessagesBySessionId(sessionId) as any,
			) as any as MessageWithParts[]

			const ok = await executeCompaction(sessionId, reloadedMessages, resolved, signal, overflow)
			if (!ok) break

			totalTokens = 0
			continue
		}

		// 13. Check if blocked by permission rejection
		if (result.blocked) {
			log.info("Loop blocked by permission rejection", { sessionId })
			break
		}

		// 14. Detect agent switches via synthetic user messages
		// Re-read messages to detect synthetic user messages from tool execution
		// (e.g. plan_exit creates a synthetic user message to switch to build)
		const updatedMessages = queries.findMessagesBySessionId(sessionId)
		const latestMessage = updatedMessages[updatedMessages.length - 1]
		if (
			latestMessage &&
			latestMessage.role === "user" &&
			(latestMessage.metadata as { synthetic?: boolean } | undefined)?.synthetic
		) {
			// A tool created a synthetic user message (e.g., plan_exit approved)
			// Continue the loop - it will pick up the new agent from the synthetic message
			continue
		}

		// 15. Check finish reason
		// "other" is used by Antigravity (Claude via Google API): Claude's "end_turn" maps to
		// Google's "OTHER" finish reason, which the @ai-sdk/google SDK reports as "other".
		if (
			result.finishReason === "stop" ||
			result.finishReason === "end_turn" ||
			result.finishReason === "other"
		) {
			break
		}

		// "tool-calls" means the model wants to continue after tool results
		if (result.finishReason === "tool-calls") {
			continue
		}

		// "length" means context overflow — will be handled by resolveIteration on next loop
		if (result.finishReason === "length") {
			continue
		}

		// Unknown finish reason — break to be safe
		log.warn("Unknown finish reason", { sessionId, finishReason: result.finishReason })
		break
	}

	// Post-loop: prune old tool outputs to free stored context (fire-and-forget)
	pruneToolOutputs(sessionId).catch((err) =>
		log.error("Tool pruning failed", { sessionId, error: err }),
	)

	// After loop completes, generate title if session has none
	const updatedSession = queries.findSessionById(sessionId)
	if (updatedSession && !updatedSession.title) {
		const allMessages = queries.findMessagesBySessionId(sessionId)
		const firstUser = allMessages.find((m) => m.role === "user")
		const firstAssistant = allMessages.find((m) => m.role === "assistant")
		if (firstUser && firstAssistant && lastModelRef) {
			// Fire-and-forget title generation
			generateTitle({
				sessionId,
				userMessage: firstUser,
				assistantMessage: firstAssistant,
				modelRef: lastModelRef,
			}).catch((err) => log.error("Title generation failed", { sessionId, error: err }))
		}
	}
}
