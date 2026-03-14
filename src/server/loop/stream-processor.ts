import { ulid } from "@core/id"
import * as Database from "../db"
import * as queries from "../db/queries"
import { createLogger } from "../logger"
import { createToolContext } from "../tool/context"
import { checkPermission } from "../tool/permission"
import type { Tool } from "../tool/shape"
import { bus } from "../workspace/bus"
import { recordAndCheckDoom } from "./doom"
import { snapshot } from "./snapshot"
import { updateSessionStatus } from "./status"

const log = createLogger("stream")

interface ToolCorrelation {
	rawInput: string
	partId: string
	startTime: number
}

interface StepUsage {
	input: number
	output: number
	reasoning?: number
	cacheRead?: number
	cacheWrite?: number
}

interface StreamResult {
	finishReason: string
	usage: StepUsage
}

interface StreamEvent {
	type: string
	[key: string]: any
}

/**
 * Process the AI SDK fullStream, handling all event types.
 *
 * Text rule: text-delta publishes SSE only, text-end persists to DB.
 * Tool rule: tool-input-start creates pending, tool-call persists running,
 *            tool-result/error persists final state.
 *
 * Uses an in-memory Map<callId, ToolCorrelation> for stream correlation.
 *
 * @param params.sessionId - Session being processed
 * @param params.messageId - Assistant message being built
 * @param params.stream - AI SDK fullStream async iterable
 * @param params.signal - AbortSignal for cancellation
 * @param params.agent - Agent name for tool context
 * @param params.tools - Available tool definitions
 * @param params.permission - Permission ruleset for the agent
 * @param params.messages - Current session messages for tool context
 * @param params.onStepFinish - Optional callback for step completion
 * @returns Stream result with finish reason and usage
 */
export async function processStream(params: {
	sessionId: string
	messageId: string
	stream: AsyncIterable<StreamEvent>
	signal: AbortSignal
	agent: string
	tools: Map<string, { shape: Tool.Shape; definition: Tool.ToolDefinition }>
	permission: { mode: string; rules: Array<{ tool: string; allow: boolean; prefix?: string }> }
	messages: any[]
	onStepFinish?: (usage: StepUsage) => void
}): Promise<StreamResult> {
	const { sessionId, messageId, stream, signal, agent, tools, permission, messages } = params

	// In-memory correlation map for tool calls
	const toolCorrelation = new Map<string, ToolCorrelation>()

	// Text accumulator (only persisted on text-end)
	let currentText = ""
	let textPartId: string | undefined

	// Reasoning accumulator
	let currentReasoning = ""
	let reasoningPartId: string | undefined
	let reasoningStartTime: number | undefined

	// Sources accumulator for current step
	let currentSources: Array<{ url: string; title?: string }> = []

	let finishReason = "stop"
	const totalUsage: StepUsage = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }

	for await (const event of stream) {
		if (signal.aborted) break

		switch (event.type) {
			case "start": {
				// Stream-level start — internal bookkeeping only
				break
			}

			case "step-start":
			case "start-step": {
				// Capture filesystem snapshot at step start
				const snapshotManager = await snapshot()
				const hash = await snapshotManager.capture()

				const stepPartId = ulid()
				Database.withEffects((_tx, effect) => {
					queries.upsertPart({
						id: stepPartId,
						sessionId,
						messageId,
						type: "step-start",
						data: { type: "step-start", snapshot: hash },
					})

					effect(() => {
						bus().emit("part:upsert", {
							sessionId,
							messageId,
							part: { id: stepPartId, type: "step-start", snapshot: hash },
						})
					})
				})
				break
			}

			case "text-start": {
				currentText = ""
				textPartId = ulid()
				break
			}

			case "text-delta": {
				currentText += event.textDelta
				// SSE only, NO DB write
				bus().emit("part:delta", {
					sessionId,
					messageId,
					partId: textPartId!,
					delta: event.textDelta,
				})
				break
			}

			case "text-end": {
				// Persist final TextPart to DB — single write for complete text
				if (currentText && textPartId) {
					const partData = {
						type: "text" as const,
						text: currentText,
					}
					Database.withEffects((_tx, effect) => {
						queries.upsertPart({
							id: textPartId!,
							sessionId,
							messageId,
							type: "text",
							data: partData,
						})

						effect(() => {
							bus().emit("part:upsert", {
								sessionId,
								messageId,
								part: { id: textPartId!, ...partData },
							})
						})
					})
				}
				currentText = ""
				textPartId = undefined
				break
			}

			case "reasoning": {
				// AI SDK v4.3 emits a single "reasoning" event per chunk with textDelta.
				// Initialize on first chunk, flush at step-finish.
				if (!reasoningPartId) {
					currentReasoning = ""
					reasoningStartTime = Date.now()
					reasoningPartId = ulid()
				}
				const reasoningDelta = (event.textDelta ?? event.delta ?? "") as string
				if (reasoningDelta) {
					currentReasoning += reasoningDelta
					bus().emit("part:delta", {
						sessionId,
						messageId,
						partId: reasoningPartId,
						delta: reasoningDelta,
					})
				}
				break
			}

			case "reasoning-start": {
				currentReasoning = ""
				reasoningStartTime = Date.now()
				reasoningPartId = ulid()
				break
			}

			case "reasoning-delta": {
				currentReasoning += event.delta
				// SSE only
				bus().emit("part:delta", {
					sessionId,
					messageId,
					partId: reasoningPartId!,
					delta: event.delta,
				})
				break
			}

			case "reasoning-end": {
				// Persist ReasoningPart
				if (currentReasoning && reasoningPartId) {
					const partData = {
						type: "reasoning" as const,
						text: currentReasoning,
						time: {
							start: reasoningStartTime ?? Date.now(),
							end: Date.now(),
						},
					}
					Database.withEffects((_tx, effect) => {
						queries.upsertPart({
							id: reasoningPartId!,
							sessionId,
							messageId,
							type: "reasoning",
							data: partData,
						})

						effect(() => {
							bus().emit("part:upsert", {
								sessionId,
								messageId,
								part: { id: reasoningPartId!, ...partData },
							})
						})
					})
				}
				currentReasoning = ""
				reasoningPartId = undefined
				reasoningStartTime = undefined
				break
			}

			case "tool-input-start": {
				// Create pending ToolPart in DB
				const partId = ulid()
				const callId = event.toolCallId as string
				const toolName = event.toolName as string

				toolCorrelation.set(callId, {
					rawInput: "",
					partId,
					startTime: Date.now(),
				})

				Database.withEffects((_tx, effect) => {
					queries.upsertPart({
						id: partId,
						sessionId,
						messageId,
						type: "tool",
						data: {
							type: "tool",
							callId,
							tool: toolName,
							state: "pending",
							time: { start: Date.now() },
						},
					})

					effect(() => {
						bus().emit("part:upsert", {
							sessionId,
							messageId,
							part: {
								id: partId,
								type: "tool",
								callId,
								tool: toolName,
								state: "pending",
								time: { start: Date.now() },
							},
						})
					})
				})
				break
			}

			case "tool-input-delta": {
				// In-memory buffer only, NO DB write
				const callId = event.toolCallId as string
				const correlation = toolCorrelation.get(callId)
				if (correlation) {
					correlation.rawInput += event.inputDelta
				}
				break
			}

			case "tool-input-end": {
				// Internal signal — tool-call handles persistence
				break
			}

			case "tool-call": {
				const callId = event.toolCallId as string
				const toolName = event.toolName as string
				const args = (event.input ?? {}) as Record<string, unknown>
				const correlation = toolCorrelation.get(callId)
				const partId = correlation?.partId ?? ulid()

				// Persist running state with parsed args
				Database.withEffects((_tx, effect) => {
					queries.upsertPart({
						id: partId,
						sessionId,
						messageId,
						type: "tool",
						data: {
							type: "tool",
							callId,
							tool: toolName,
							state: "running",
							input: args,
							time: { start: correlation?.startTime ?? Date.now() },
						},
					})

					effect(() => {
						bus().emit("part:upsert", {
							sessionId,
							messageId,
							part: {
								id: partId,
								type: "tool",
								callId,
								tool: toolName,
								state: "running",
								input: args,
								time: { start: correlation?.startTime ?? Date.now() },
							},
						})
					})
				})

				// Check doom loop
				const isDoom = recordAndCheckDoom(sessionId, toolName, args)
				if (isDoom) {
					updateSessionStatus(sessionId, "awaiting-permission")
					// Emit permission request for doom loop
					bus().emit("permission:request", {
						sessionId,
						request: {
							id: callId,
							sessionId,
							tool: toolName,
							input: args,
							reason: `Doom loop detected: ${toolName} called 3 times with identical arguments`,
							type: "doom_loop",
						},
					})
					// The loop caller will handle awaiting permission response
					break
				}

				// Check permission
				const allowed = checkPermission(toolName, args, permission)
				if (allowed === false) {
					// Tool explicitly denied
					Database.withEffects((_tx, effect) => {
						queries.upsertPart({
							id: partId,
							sessionId,
							messageId,
							type: "tool",
							data: {
								type: "tool",
								callId,
								tool: toolName,
								state: "error",
								input: args,
								error: "Permission denied",
								time: {
									start: correlation?.startTime ?? Date.now(),
									end: Date.now(),
								},
							},
						})

						effect(() => {
							bus().emit("part:upsert", {
								sessionId,
								messageId,
								part: {
									id: partId,
									type: "tool",
									callId,
									tool: toolName,
									state: "error",
									input: args,
									error: "Permission denied",
								},
							})
						})
					})
					break
				}

				if (allowed === null) {
					// Needs user confirmation
					updateSessionStatus(sessionId, "awaiting-permission")
					bus().emit("permission:request", {
						sessionId,
						request: {
							id: callId,
							sessionId,
							tool: toolName,
							input: args,
							type: "tool",
						},
					})
					// Permission resolution is handled externally
					break
				}

				// Execute the tool
				const toolEntry = tools.get(toolName)
				if (!toolEntry) {
					Database.withEffects((_tx, effect) => {
						queries.upsertPart({
							id: partId,
							sessionId,
							messageId,
							type: "tool",
							data: {
								type: "tool",
								callId,
								tool: toolName,
								state: "error",
								input: args,
								error: `Unknown tool: ${toolName}`,
								time: {
									start: correlation?.startTime ?? Date.now(),
									end: Date.now(),
								},
							},
						})

						effect(() => {
							bus().emit("part:upsert", {
								sessionId,
								messageId,
								part: {
									id: partId,
									type: "tool",
									callId,
									tool: toolName,
									state: "error",
									input: args,
									error: `Unknown tool: ${toolName}`,
								},
							})
						})
					})
					break
				}

				try {
					const ctx = createToolContext({
						sessionId,
						messageId,
						agent,
						signal,
						callId,
						toolName,
						messages,
					})
					const result = await toolEntry.definition.execute(ctx, args)

					Database.withEffects((_tx, effect) => {
						queries.upsertPart({
							id: partId,
							sessionId,
							messageId,
							type: "tool",
							data: {
								type: "tool",
								callId,
								tool: toolName,
								state: "completed",
								input: args,
								output: result.output,
								metadata: result.metadata,
								time: {
									start: correlation?.startTime ?? Date.now(),
									end: Date.now(),
								},
							},
						})

						effect(() => {
							bus().emit("part:upsert", {
								sessionId,
								messageId,
								part: {
									id: partId,
									type: "tool",
									callId,
									tool: toolName,
									state: "completed",
									input: args,
									output: result.output,
									metadata: result.metadata,
								},
							})
						})
					})
				} catch (err) {
					const errorMessage = err instanceof Error ? err.message : String(err)
					Database.withEffects((_tx, effect) => {
						queries.upsertPart({
							id: partId,
							sessionId,
							messageId,
							type: "tool",
							data: {
								type: "tool",
								callId,
								tool: toolName,
								state: "error",
								input: args,
								error: errorMessage,
								time: {
									start: correlation?.startTime ?? Date.now(),
									end: Date.now(),
								},
							},
						})

						effect(() => {
							bus().emit("part:upsert", {
								sessionId,
								messageId,
								part: {
									id: partId,
									type: "tool",
									callId,
									tool: toolName,
									state: "error",
									input: args,
									error: errorMessage,
								},
							})
						})
					})
				}
				break
			}

			case "tool-result": {
				// Tool result from AI SDK (for built-in tool handling)
				const callId = event.toolCallId as string
				const correlation = toolCorrelation.get(callId)
				const partId = correlation?.partId ?? ulid()
				const output =
					typeof event.result === "string" ? event.result : JSON.stringify(event.result)

				Database.withEffects((_tx, effect) => {
					queries.upsertPart({
						id: partId,
						sessionId,
						messageId,
						type: "tool",
						data: {
							type: "tool",
							callId,
							tool: event.toolName ?? "unknown",
							state: "completed",
							output,
							time: {
								start: correlation?.startTime ?? Date.now(),
								end: Date.now(),
							},
						},
					})

					effect(() => {
						bus().emit("part:upsert", {
							sessionId,
							messageId,
							part: {
								id: partId,
								type: "tool",
								callId,
								tool: event.toolName ?? "unknown",
								state: "completed",
								output,
							},
						})
					})
				})
				break
			}

			case "tool-error": {
				const callId = event.toolCallId as string
				const correlation = toolCorrelation.get(callId)
				const partId = correlation?.partId ?? ulid()
				const errorMessage = typeof event.error === "string" ? event.error : String(event.error)

				Database.withEffects((_tx, effect) => {
					queries.upsertPart({
						id: partId,
						sessionId,
						messageId,
						type: "tool",
						data: {
							type: "tool",
							callId,
							tool: event.toolName ?? "unknown",
							state: "error",
							error: errorMessage,
							time: {
								start: correlation?.startTime ?? Date.now(),
								end: Date.now(),
							},
						},
					})

					effect(() => {
						bus().emit("part:upsert", {
							sessionId,
							messageId,
							part: {
								id: partId,
								type: "tool",
								callId,
								tool: event.toolName ?? "unknown",
								state: "error",
								error: errorMessage,
							},
						})
					})
				})
				break
			}

			case "step-finish":
			case "finish-step": {
				// Flush accumulated reasoning before finishing step
				// (AI SDK v4.3 "reasoning" events have no explicit end signal)
				if (currentReasoning && reasoningPartId) {
					const reasoningData = {
						type: "reasoning" as const,
						text: currentReasoning,
						time: {
							start: reasoningStartTime ?? Date.now(),
							end: Date.now(),
						},
					}
					Database.withEffects((_tx, effect) => {
						queries.upsertPart({
							id: reasoningPartId!,
							sessionId,
							messageId,
							type: "reasoning",
							data: reasoningData,
						})

						effect(() => {
							bus().emit("part:upsert", {
								sessionId,
								messageId,
								part: { id: reasoningPartId!, ...reasoningData },
							})
						})
					})
					currentReasoning = ""
					reasoningPartId = undefined
					reasoningStartTime = undefined
				}

				// Persist StepFinishPart with usage
				const usage = event.usage as StepUsage | undefined
				const stepFinishReason = (event.finishReason as string) ?? "stop"

				if (usage) {
					totalUsage.input += usage.input ?? 0
					totalUsage.output += usage.output ?? 0
					totalUsage.reasoning = (totalUsage.reasoning ?? 0) + (usage.reasoning ?? 0)
					totalUsage.cacheRead = (totalUsage.cacheRead ?? 0) + (usage.cacheRead ?? 0)
					totalUsage.cacheWrite = (totalUsage.cacheWrite ?? 0) + (usage.cacheWrite ?? 0)
				}

				// Capture post-step snapshot
				const snapshotManager = await snapshot()
				const postHash = await snapshotManager.capture()

				const stepFinishPartId = ulid()
				Database.withEffects((_tx, effect) => {
					queries.upsertPart({
						id: stepFinishPartId,
						sessionId,
						messageId,
						type: "step-finish",
						data: {
							type: "step-finish",
							finishReason: stepFinishReason,
							usage,
							snapshot: postHash,
							sources: currentSources.length > 0 ? currentSources : undefined,
						},
					})

					effect(() => {
						bus().emit("part:upsert", {
							sessionId,
							messageId,
							part: {
								id: stepFinishPartId,
								type: "step-finish",
								finishReason: stepFinishReason,
								usage,
								snapshot: postHash,
								sources: currentSources.length > 0 ? currentSources : undefined,
							},
						})
					})
				})

				// Reset sources for next step
				currentSources = []

				params.onStepFinish?.(usage ?? { input: 0, output: 0 })
				break
			}

			case "finish": {
				finishReason = (event.finishReason as string) ?? "stop"
				break
			}

			case "error": {
				const errorMessage =
					event.error instanceof Error ? event.error.message : String(event.error)
				log.error("Stream error", { sessionId, error: errorMessage })

				// Persist error as a retry part
				const retryPartId = ulid()
				Database.withEffects((_tx, effect) => {
					queries.upsertPart({
						id: retryPartId,
						sessionId,
						messageId,
						type: "retry",
						data: {
							type: "retry",
							error: errorMessage,
							attempt: 0,
							timestamp: Date.now(),
						},
					})

					effect(() => {
						bus().emit("part:upsert", {
							sessionId,
							messageId,
							part: {
								id: retryPartId,
								type: "retry",
								error: errorMessage,
								attempt: 0,
								timestamp: Date.now(),
							},
						})
					})
				})
				break
			}

			case "source": {
				// Accumulate sources for inclusion in step-finish
				const url = event.url as string | undefined
				const title = event.title as string | undefined
				if (url) {
					currentSources.push({ url, title })
				}
				break
			}

			case "file": {
				// Persist file part
				const filePartId = ulid()
				Database.withEffects((_tx, effect) => {
					queries.upsertPart({
						id: filePartId,
						sessionId,
						messageId,
						type: "file",
						data: {
							type: "file",
							path: event.path ?? "unknown",
							mimeType: event.mimeType ?? "application/octet-stream",
							content: event.content ?? "",
						},
					})

					effect(() => {
						bus().emit("part:upsert", {
							sessionId,
							messageId,
							part: {
								id: filePartId,
								type: "file",
								path: event.path ?? "unknown",
								mimeType: event.mimeType ?? "application/octet-stream",
								content: event.content ?? "",
							},
						})
					})
				})
				break
			}

			case "raw": {
				// Ignore raw events unless debugging
				break
			}

			default: {
				// Unknown event type — log for diagnostics
				log.warn("Unknown event type", { sessionId, eventType: event.type })
				break
			}
		}
	}

	return { finishReason, usage: totalUsage }
}
