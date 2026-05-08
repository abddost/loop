import { filterCompacted } from "@core/message/compact"
import { toModelMessages } from "@core/message/convert"
import type { MessageWithParts } from "@core/schema/message"
import { tool as aiTool, jsonSchema } from "ai"
import { AgentRegistry } from "../agent"
import { insertReminders } from "../agent/prompt/inject"
import { assembleSystemPrompt } from "../agent/prompt/system"
import * as Config from "../config"
import * as Database from "../db"
import * as queries from "../db/queries"
import { createLogger } from "../logger"
import { allMcpTools } from "../mcp"
import { resolveRuleset } from "../permission"
import { ProviderRegistry, ProviderTransform, streamWithRetry } from "../provider"
import { filterTools } from "../tool/filter"
import { ToolRegistry } from "../tool/registry"
import type { Tool } from "../tool/shape"
import { bus } from "../workspace/bus"
import {
	COMPACTION_BUFFER,
	COMPACTION_RETRY_LIMIT,
	COMPACTION_USER_PROMPT,
	estimateMessageTokens,
	extractSummaryBody,
	hasModelTurnSinceCompaction,
	needsCompaction,
	pruneToolOutputs,
	runCompaction,
	truncateForCompaction,
} from "./compaction"
import { enrichFileParts } from "./enrich-files"
import { setSessionStatus } from "./status"
import { processStream } from "./stream-processor"
import { ensureSessionTitle } from "./title"
import { resolveAssistantMessageId } from "./user-message"

const log = createLogger("loop")

export interface PromptBody {
	messageId?: string
	assistantMessageId?: string
	text?: string
	files?: Array<{ path: string; mimeType: string; content: string }>
	model?: { modelId: string; providerId: string }
	agent?: string
	option?: string
	synthetic?: boolean
	tools?: Record<string, boolean>
	reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max" | "ultrathink"
	/** Claude Code effort level (low/medium/high/max/ultrathink). */
	effort?: string
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

	// Check context overflow — but only if a real model turn has happened
	// since the last compaction boundary. Prevents re-compacting immediately
	// when the only messages are the summary + boundary + continuation.
	if (
		needsCompaction(totalTokens, contextWindow, maxOutput) &&
		hasModelTurnSinceCompaction(messages)
	) {
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
	const compactionBudget =
		resolved.info.contextWindow -
		ProviderTransform.maxOutputTokens(resolved.info) -
		COMPACTION_BUFFER
	const compactionMessages =
		estimateMessageTokens(prunedMessages) > compactionBudget
			? truncateForCompaction(prunedMessages, compactionBudget)
			: prunedMessages

	const compactionPrompt = await assembleSystemPrompt({
		agent: compactionAgent,
		modelId: resolved.info.id,
	})

	const rawCompactionMessages = toModelMessages(compactionMessages)
	const coreMessages = ProviderTransform.messages(
		rawCompactionMessages,
		resolved.info,
		resolved.npm,
	)

	coreMessages.push({ role: "user", content: COMPACTION_USER_PROMPT })

	const compactionStream = await streamWithRetry(
		{
			model: resolved.instance,
			system: compactionPrompt,
			messages: coreMessages,
			temperature: compactionAgent.temperature ?? 0,
			maxOutputTokens: ProviderTransform.maxOutputTokens(resolved.info),
		},
		signal,
	)

	// Collect the compaction summary
	let rawSummary = ""
	for await (const chunk of compactionStream.fullStream) {
		if (signal.aborted) break
		if (chunk.type === "text-delta") {
			rawSummary += chunk.text
		}
	}

	// Strip the <analysis> scratchpad; persist only the <summary> body.
	const summaryText = extractSummaryBody(rawSummary)

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
	let consecutiveCompactions = 0

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
			ProviderTransform.maxOutputTokens(resolved.info),
		)

		if (decision.type === "done") break

		if (decision.type === "compact") {
			consecutiveCompactions++
			if (consecutiveCompactions > COMPACTION_RETRY_LIMIT) {
				log.error("Compaction circuit breaker triggered", {
					sessionId,
					consecutiveCompactions,
				})
				break
			}

			const ok = await executeCompaction(sessionId, messages, resolved, signal)
			if (!ok) break

			totalTokens = 0
			continue
		}

		// 6. Assemble system prompt. Plan mode is signaled to the assembler
		// by EITHER the agent identity (`plan`/`explore`) OR the session
		// permission mode (`plan` toggle in the input bar). The assembler
		// appends the tool-policy block when active so the model sees the
		// constraints at system-prompt authority — not as a user-message
		// reminder that's easy to ignore.
		const planModeActive =
			agent.name === "plan" || agent.name === "explore" || sessionPermissionMode === "plan"
		const wasPlan = messages.some(
			(m) =>
				m.role === "assistant" && (m.metadata as { agent?: string } | undefined)?.agent === "plan",
		)
		const buildSwitchActive = wasPlan && agent.name === "build"
		const systemPrompt = await assembleSystemPrompt({
			agent,
			modelId: resolved.info.id,
			systemOverride: undefined,
			sessionId,
			planModeActive,
			buildSwitchActive,
		})

		// 7. Insert agent-specific reminders into messages (in-memory only).
		// These are belt-and-suspenders reinforcement of the system-prompt
		// constraints — useful when the model's attention is on the recent
		// conversation rather than the system prompt.
		insertReminders({ messages, agent, sessionId, sessionPermissionMode })

		// 7b. Enrich file parts (directory listings, etc.) — in-memory only
		const enrichedMessages = await enrichFileParts(messages)

		// 8. Convert to ModelMessage[] and apply provider-specific transforms.
		// The system prompt is prepended as a role:"system" message so that
		// applyCaching marks it for caching (Anthropic ephemeral cache breakpoint),
		// Passing system in the messages array lets applyCaching attach breakpoints.
		const rawCoreMessages: import("ai").ModelMessage[] = [
			{ role: "system", content: systemPrompt },
			...toModelMessages(enrichedMessages),
		]
		const coreMessages = ProviderTransform.messages(rawCoreMessages, resolved.info, resolved.npm)

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
			// MCP tools carry a raw JSON Schema from the server — use it directly
			// so the model sees actual parameter definitions instead of an empty object.
			const schema = entry.definition.rawInputSchema
				? jsonSchema(entry.definition.rawInputSchema as any)
				: entry.definition.parameters

			aiTools[name] = aiTool({
				description: entry.definition.description,
				inputSchema: schema,
			})
		}

		// 10. Create assistant message (with agent tracking)
		const assistantMessageId = resolveAssistantMessageId(body)
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

		// Build providerOptions: merge session-level cache keys with reasoning effort.
		// System prompt caching is handled at the message level via applyCaching above.
		const sessionCacheOpts = ProviderTransform.sessionCacheOptions(
			resolved.info,
			resolved.npm,
			sessionId,
		)
		const providerOptions = {
			...sessionCacheOpts,
			...(reasoningEffort && { openai: { reasoningEffort } }),
		}

		const streamParams = {
			model: resolved.instance,
			// No system: param — system prompt is included as role:"system" in coreMessages
			// so applyCaching can attach cache breakpoints to it.
			messages: coreMessages,
			tools: Object.keys(aiTools).length > 0 ? aiTools : undefined,
			temperature: agent.temperature,
			topP: agent.topP,
			maxOutputTokens: ProviderTransform.maxOutputTokens(resolved.info),
			// NOTE: text-delta pacing for the smooth-streaming visual is done
			// CLIENT-SIDE in `src/app/lib/streaming-buffer.ts` (metronome reveal).
			// Doing it there instead of via `experimental_transform: smoothStream`
			// covers all three streaming adapters (AI SDK / Claude Agent SDK /
			// Cursor SDK) uniformly and avoids holding the SSE connection open.
			...(Object.keys(providerOptions).length > 0 && { providerOptions }),
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
			maxOutput: ProviderTransform.maxOutputTokens(resolved.info),
			onStepFinish: (usage) => {
				// Set (not accumulate): each step's input already includes all prior
				// context, so the last step's total is the best measure of context fullness.
				totalTokens = (usage.input ?? 0) + (usage.output ?? 0) + (usage.reasoning ?? 0)
			},
		})

		// Update assistant message with finish reason + usage. Persisting
		// tokens/cost here (not just on the transient session:usage SSE event)
		// is what lets the UsageBar re-derive context-window state after the
		// app is reloaded.
		queries.updateMessage(assistantMessageId, {
			metadata: {
				modelId: resolved.info.id,
				providerId: modelRef.providerId,
				finish: result.finishReason,
				agent: agentName,
				tokens: result.usage,
				cost: result.cost,
				contextWindow: resolved.info.contextWindow,
			},
		})

		// A normal model turn completed — reset circuit breaker
		consecutiveCompactions = 0

		// Fire-and-forget title generation on first step. The `ensureSessionTitle`
		// helper owns its own AbortController + timeout, so a main-loop abort
		// won't cancel it, and a hanging model call won't keep the promise
		// pending forever. Idempotent via the `!session.title` guard.
		if (stepCount === 1 && lastModelRef) {
			ensureSessionTitle({ sessionId, modelRef: lastModelRef }).catch((err) =>
				log.error("ensureSessionTitle failed", { sessionId, error: err }),
			)
		}

		// 12. Handle compaction signal from stream processor
		if (result.needsCompaction) {
			consecutiveCompactions++
			if (consecutiveCompactions > COMPACTION_RETRY_LIMIT) {
				log.error("Compaction circuit breaker triggered", {
					sessionId,
					consecutiveCompactions,
				})
				break
			}

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
		// "other" is used by Antigravity: the upstream "end_turn" maps to
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

	// Post-loop safety net: if the step-1 title attempt was skipped (e.g. the
	// first stream erred before any assistant message persisted) or silently
	// failed, try once more now that the turn is complete. Short-circuits on
	// the happy path via `!session.title`.
	if (lastModelRef) {
		ensureSessionTitle({ sessionId, modelRef: lastModelRef }).catch((err) =>
			log.error("ensureSessionTitle (post-loop) failed", { sessionId, error: err }),
		)
	}

	// Post-loop: prune old tool outputs to free stored context (fire-and-forget)
	pruneToolOutputs(sessionId).catch((err) =>
		log.error("Tool pruning failed", { sessionId, error: err }),
	)
}
