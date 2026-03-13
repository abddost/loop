import { ulid } from "@core/id"
import { filterCompacted } from "@core/message/compact"
import { toModelMessages } from "@core/message/convert"
import type { MessageWithParts } from "@core/schema/message"
import { tool as aiTool } from "ai"
import { AgentRegistry } from "../agent"
import { assembleSystemPrompt } from "../agent/prompt/system"
import * as Database from "../db"
import * as queries from "../db/queries"
import { ProviderRegistry, streamWithRetry } from "../provider"
import { filterTools } from "../tool/filter"
import { ToolRegistry } from "../tool/registry"
import type { Tool } from "../tool/shape"
import { bus } from "../workspace/bus"
import { needsCompaction, runCompaction } from "./compaction"
import { updateSessionStatus } from "./status"
import { processStream } from "./stream-processor"
import { generateTitle } from "./title"

export interface PromptBody {
	text?: string
	files?: Array<{ path: string; mimeType: string; content: string }>
	model?: { modelId: string; providerId: string }
	agent?: string
	option?: string
	synthetic?: boolean
	tools?: Record<string, boolean>
}

interface IterationDecision {
	type: "done" | "compact" | "continue"
	reminders?: string[]
}

/**
 * Resolve the iteration decision for the agentic loop.
 * Examines the last messages to determine whether the loop should continue,
 * compact, or stop.
 *
 * @param messages - Current session messages (post-compaction filter)
 * @param totalTokens - Accumulated token count
 * @param contextWindow - Model's context window size
 * @returns Decision on whether to continue, compact, or stop
 */
function resolveIteration(
	messages: MessageWithParts[],
	totalTokens: number,
	contextWindow: number,
): IterationDecision {
	if (messages.length === 0) return { type: "continue" }

	// Check context overflow
	if (needsCompaction(totalTokens, contextWindow)) {
		return { type: "compact" }
	}

	const lastMessage = messages[messages.length - 1]

	// If last message is user, continue (fresh prompt)
	if (lastMessage.role === "user") return { type: "continue" }

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
 * Filters tools based on agent permissions and model capabilities,
 * then initializes each tool's definition.
 *
 * @param allTools - All registered tool shapes
 * @param agent - The active agent
 * @param modelInfo - The active model info
 * @returns Map of tool name to shape + definition
 */
function buildToolSet(
	allTools: Tool.Shape[],
	agent: {
		name: string
		permission: { mode: string; rules: Array<{ tool: string; allow: boolean }> }
	},
	modelInfo: { supportsTools: boolean },
): Map<string, { shape: Tool.Shape; definition: Tool.ToolDefinition }> {
	const filtered = filterTools(allTools, agent, modelInfo as any)
	const result = new Map<string, { shape: Tool.Shape; definition: Tool.ToolDefinition }>()

	for (const shape of filtered) {
		const definition = shape.init(agent.name)
		result.set(shape.id, { shape, definition })
	}

	return result
}

/**
 * The core agentic loop. Runs as fire-and-forget from the prompt handler.
 * Inherits workspace context from ALS.
 *
 * Loop skeleton:
 * 1. Load session + resolve agent + model
 * 2. Load messages+parts, filterCompacted(), post-compaction only
 * 3. Resolve iteration decision (done/compact/continue)
 * 4. Assemble system prompt (7-step order)
 * 5. Convert to CoreMessage[] via toModelMessages()
 * 6. Check context overflow, compact if needed
 * 7. Build tool set (filter by agent + model)
 * 8. streamWithRetry() to get AI SDK stream
 * 9. Process stream events
 * 10. Post-step: snapshot, doom check
 * 11. Check finish reason: break on "stop", continue on "tool-calls"
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
	// 1. Load session + resolve agent + model
	const session = queries.findSessionById(sessionId)
	if (!session) throw new Error(`Session not found: ${sessionId}`)

	const agentName = body?.agent ?? "build"
	const agent = AgentRegistry.get(agentName)
	if (!agent) throw new Error(`Agent not found: ${agentName}`)

	const modelRef = body?.model ?? agent.model
	if (!modelRef) throw new Error("No model specified in prompt body or agent configuration")

	const resolved = ProviderRegistry.resolveModel(modelRef.providerId, modelRef.modelId)
	const maxSteps = agent.steps ?? 100
	let stepCount = 0
	let totalTokens = 0

	while (!signal.aborted) {
		stepCount++
		if (stepCount > maxSteps) {
			console.warn(`[loop] Max steps (${maxSteps}) reached for session ${sessionId}`)
			break
		}

		// 2. Load messages+parts, filter by compaction boundary
		const rawMessages = queries.findMessagesBySessionId(sessionId)
		const messages = filterCompacted(rawMessages as any) as any as MessageWithParts[]

		// 3. Resolve iteration decision
		const decision = resolveIteration(messages, totalTokens, resolved.info.contextWindow)

		if (decision.type === "done") break

		if (decision.type === "compact") {
			updateSessionStatus(sessionId, "busy")

			// Run compaction agent to get summary
			const compactionAgent = AgentRegistry.get("compaction")
			if (!compactionAgent) {
				console.error("[loop] Compaction agent not found, stopping loop")
				break
			}

			const compactionPrompt = await assembleSystemPrompt({
				agent: compactionAgent,
				modelId: resolved.info.id,
			})

			const coreMessages = toModelMessages(messages)
			const compactionStream = await streamWithRetry(
				{
					model: resolved.instance,
					system: compactionPrompt,
					messages: coreMessages,
					temperature: compactionAgent.temperature ?? 0,
					maxTokens: resolved.info.maxOutput,
				},
				signal,
			)

			// Collect the compaction summary
			let summaryText = ""
			for await (const chunk of compactionStream.fullStream) {
				if (signal.aborted) break
				if (chunk.type === "text-delta") {
					summaryText += chunk.textDelta
				}
			}

			await runCompaction({
				sessionId,
				messages,
				summary: summaryText,
				signal,
			})

			// Continue the loop with compacted context
			totalTokens = 0
			continue
		}

		// 4. Assemble system prompt (7-step order)
		const systemPrompt = await assembleSystemPrompt({
			agent,
			modelId: resolved.info.id,
			systemOverride: undefined,
			activeMode: agentName === "plan" ? "plan" : agentName === "build" ? "build" : undefined,
		})

		// 5. Convert to CoreMessage[]
		const coreMessages = toModelMessages(messages)

		// 7. Build tool set
		const toolSet = buildToolSet(ToolRegistry.all(), agent, resolved.info)

		// Convert tool set to AI SDK format (no execute — we handle execution in processStream)
		const aiTools: Record<string, any> = {}
		for (const [name, entry] of toolSet) {
			aiTools[name] = aiTool({
				description: entry.definition.description,
				parameters: entry.definition.parameters,
			})
		}

		// 8. Create assistant message
		const assistantMessageId = ulid()
		Database.withEffects((_tx, effect) => {
			queries.createMessage({
				id: assistantMessageId,
				sessionId,
				role: "assistant",
				metadata: { modelId: resolved.info.id },
			})

			effect(() => {
				bus().emit("message:create", {
					sessionId,
					message: {
						id: assistantMessageId,
						sessionId,
						role: "assistant",
						metadata: { modelId: resolved.info.id },
						createdAt: Date.now(),
						updatedAt: Date.now(),
						parts: [],
					},
				})
			})
		})

		// 9. Stream with retry
		const streamResult = await streamWithRetry(
			{
				model: resolved.instance,
				system: systemPrompt,
				messages: coreMessages,
				tools: Object.keys(aiTools).length > 0 ? aiTools : undefined,
				temperature: agent.temperature,
				topP: agent.topP,
				maxTokens: resolved.info.maxOutput,
			},
			signal,
			undefined,
			(attempt, error, delayMs) => {
				console.log(
					`[loop] Retry ${attempt} for session ${sessionId}: ${error.message} (delay: ${delayMs}ms)`,
				)
				updateSessionStatus(sessionId, "retry")
				bus().emit("session:status", { sessionId, status: "retry" })
			},
		)

		// 10. Process stream events
		updateSessionStatus(sessionId, "busy")

		const result = await processStream({
			sessionId,
			messageId: assistantMessageId,
			stream: streamResult.fullStream,
			signal,
			agent: agentName,
			tools: toolSet,
			permission: agent.permission,
			messages: rawMessages as any,
			onStepFinish: (usage) => {
				totalTokens += (usage.input ?? 0) + (usage.output ?? 0) + (usage.reasoning ?? 0)
			},
		})

		// Update assistant message with finish reason
		queries.updateMessage(assistantMessageId, {
			metadata: {
				modelId: resolved.info.id,
				finish: result.finishReason,
			},
		})

		// 11. Check finish reason
		if (result.finishReason === "stop" || result.finishReason === "end_turn") {
			break
		}

		// "tool-calls" means the model wants to continue after tool results
		if (result.finishReason === "tool-calls") {
			continue
		}

		// "length" means context overflow
		if (result.finishReason === "length") {
			// Will be handled by resolveIteration on next loop
			continue
		}

		// Unknown finish reason — break to be safe
		console.warn(`[loop] Unknown finish reason "${result.finishReason}" for session ${sessionId}`)
		break
	}

	// After loop completes, generate title if session has none
	const updatedSession = queries.findSessionById(sessionId)
	if (updatedSession && !updatedSession.title) {
		const allMessages = queries.findMessagesBySessionId(sessionId)
		const firstUser = allMessages.find((m) => m.role === "user")
		const firstAssistant = allMessages.find((m) => m.role === "assistant")
		if (firstUser && firstAssistant) {
			// Fire-and-forget title generation
			generateTitle({
				sessionId,
				userMessage: firstUser,
				assistantMessage: firstAssistant,
				modelRef: modelRef,
			}).catch((err) => console.error("[title]", err))
		}
	}
}
