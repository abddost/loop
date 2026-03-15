import { ulid } from "@core/id"
import type { PermissionRuleset } from "@core/schema/permission"
import * as Database from "../db"
import * as queries from "../db/queries"
import { createLogger } from "../logger"
import { CorrectedError, DeniedError, RejectedError } from "../permission/types"
import { createToolContext } from "../tool/context"
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
	/** Whether the stream was blocked by a permission rejection. */
	blocked: boolean
}

interface StreamEvent {
	type: string
	[key: string]: any
}

/**
 * Process the AI SDK fullStream, handling all event types.
 *
 * Permission checking is delegated to the tools themselves via ctx.ask().
 * The stream processor catches permission errors (DeniedError, RejectedError,
 * CorrectedError) and records them as tool errors.
 *
 * When a user rejects a permission request, the loop is blocked and stops.
 */
export async function processStream(params: {
	sessionId: string
	messageId: string
	stream: AsyncIterable<StreamEvent>
	signal: AbortSignal
	agent: string
	tools: Map<string, { shape: Tool.Shape; definition: Tool.ToolDefinition }>
	ruleset: PermissionRuleset
	messages: any[]
	onStepFinish?: (usage: StepUsage) => void
}): Promise<StreamResult> {
	const { sessionId, messageId, stream, signal, agent, tools, ruleset, messages } = params

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
	let blocked = false
	const totalUsage: StepUsage = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }

	for await (const event of stream) {
		if (signal.aborted || blocked) break

		switch (event.type) {
			case "start": {
				break
			}

			case "start-step": {
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
				currentText += event.text
				bus().emit("part:delta", {
					sessionId,
					messageId,
					partId: textPartId!,
					delta: event.text,
				})
				break
			}

			case "text-end": {
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

			case "reasoning-start": {
				currentReasoning = ""
				reasoningStartTime = Date.now()
				reasoningPartId = ulid()
				break
			}

			case "reasoning-delta": {
				currentReasoning += event.text
				bus().emit("part:delta", {
					sessionId,
					messageId,
					partId: reasoningPartId!,
					delta: event.text,
				})
				break
			}

			case "reasoning-end": {
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
				const partId = ulid()
				const callId = event.id as string
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
				const callId = event.id as string
				const correlation = toolCorrelation.get(callId)
				if (correlation) {
					correlation.rawInput += event.delta
				}
				break
			}

			case "tool-input-end": {
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

				// Check doom loop — same tool called 3 times with identical args
				const isDoom = recordAndCheckDoom(sessionId, toolName, args)
				if (isDoom) {
					// Doom loop triggers a special permission check via the tool context
					// The ask() call with permission "doom_loop" will either allow or block
					updateSessionStatus(sessionId, "awaiting-permission")
				}

				// Execute the tool — permission checking happens inside via ctx.ask()
				const toolEntry = tools.get(toolName)
				if (!toolEntry) {
					persistToolError(
						partId,
						sessionId,
						messageId,
						callId,
						toolName,
						args,
						`Unknown tool: ${toolName}`,
						correlation?.startTime,
					)
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
						ruleset,
					})

					// If doom loop was detected, ask for doom_loop permission before tool execution
					if (isDoom) {
						const { ask: permissionAsk } = await import("../permission/permission")
						await permissionAsk({
							id: `${callId}:doom`,
							sessionId,
							permission: "doom_loop",
							patterns: [toolName],
							always: [toolName],
							ruleset,
							metadata: {
								reason: `Doom loop detected: ${toolName} called 3 times with identical arguments`,
							},
						})
						updateSessionStatus(sessionId, "busy")
					}

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
					// Handle permission-specific errors
					if (err instanceof RejectedError || err instanceof CorrectedError) {
						const errorMessage = err.message
						persistToolError(
							partId,
							sessionId,
							messageId,
							callId,
							toolName,
							args,
							errorMessage,
							correlation?.startTime,
						)
						blocked = true // Stop processing — user rejected
						updateSessionStatus(sessionId, "idle")
						break
					}

					if (err instanceof DeniedError) {
						persistToolError(
							partId,
							sessionId,
							messageId,
							callId,
							toolName,
							args,
							err.message,
							correlation?.startTime,
						)
						// Denied by config rule — record error but continue processing
						break
					}

					// Generic tool error
					const errorMessage = err instanceof Error ? err.message : String(err)
					persistToolError(
						partId,
						sessionId,
						messageId,
						callId,
						toolName,
						args,
						errorMessage,
						correlation?.startTime,
					)
				}
				break
			}

			case "tool-result": {
				const callId = event.toolCallId as string
				const correlation = toolCorrelation.get(callId)
				const partId = correlation?.partId ?? ulid()
				const output =
					typeof event.output === "string" ? event.output : JSON.stringify(event.output)

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

			case "finish-step": {
				// Flush accumulated reasoning before finishing step
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
				const rawUsage = event.usage as
					| {
							inputTokens?: number
							outputTokens?: number
							outputTokenDetails?: { reasoningTokens?: number }
							inputTokenDetails?: {
								cacheReadTokens?: number
								cacheWriteTokens?: number
							}
					  }
					| undefined
				const usage: StepUsage | undefined = rawUsage
					? {
							input: rawUsage.inputTokens ?? 0,
							output: rawUsage.outputTokens ?? 0,
							reasoning: rawUsage.outputTokenDetails?.reasoningTokens ?? 0,
							cacheRead: rawUsage.inputTokenDetails?.cacheReadTokens ?? 0,
							cacheWrite: rawUsage.inputTokenDetails?.cacheWriteTokens ?? 0,
						}
					: undefined
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
				const url = event.url as string | undefined
				const title = event.title as string | undefined
				if (url) {
					currentSources.push({ url, title })
				}
				break
			}

			case "file": {
				const filePartId = ulid()
				const file = event.file as { mediaType: string; base64: string } | undefined
				const mediaType = file?.mediaType ?? "application/octet-stream"
				const content = file?.base64 ?? ""
				Database.withEffects((_tx, effect) => {
					queries.upsertPart({
						id: filePartId,
						sessionId,
						messageId,
						type: "file",
						data: {
							type: "file",
							path: "generated",
							mimeType: mediaType,
							content,
						},
					})

					effect(() => {
						bus().emit("part:upsert", {
							sessionId,
							messageId,
							part: {
								id: filePartId,
								type: "file",
								path: "generated",
								mimeType: mediaType,
								content,
							},
						})
					})
				})
				break
			}

			case "raw": {
				break
			}

			default: {
				log.warn("Unknown event type", { sessionId, eventType: event.type })
				break
			}
		}
	}

	return { finishReason, usage: totalUsage, blocked }
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function persistToolError(
	partId: string,
	sessionId: string,
	messageId: string,
	callId: string,
	toolName: string,
	args: Record<string, unknown>,
	error: string,
	startTime?: number,
): void {
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
				error,
				time: {
					start: startTime ?? Date.now(),
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
					error,
				},
			})
		})
	})
}
