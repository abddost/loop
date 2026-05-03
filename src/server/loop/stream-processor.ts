import { ulid } from "@core/id"
import type { PermissionRuleset } from "@core/schema/permission"
import * as Database from "../db"
import * as queries from "../db/queries"
import { createLogger } from "../logger"
import { CorrectedError, DeniedError, RejectedError } from "../permission/types"
import { createToolContext } from "../tool/context"
import type { Tool } from "../tool/shape"
import { bus } from "../workspace/bus"
import { CHARS_PER_TOKEN, needsCompaction } from "./compaction"
import { type Pricing, computeStepCost } from "./cost"
import { recordAndCheckDoom } from "./doom"
import { classifyError, retryDelay, retrySleep } from "./retry"
import { snapshot } from "./snapshot"
import { setSessionStatus } from "./status"

const log = createLogger("stream")

const log = createLogger("stream")

interface ToolCorrelation {
	rawInput: string
	partId: string
	startTime: number
	toolName: string
	input?: Record<string, unknown>
}

export interface StepUsage {
	input: number
	output: number
	reasoning?: number
	cacheRead?: number
	cacheWrite?: number
}

export interface StreamResult {
	finishReason: string
	usage: StepUsage
	/** Accumulated cost in USD for all steps in this stream. */
	cost: number
	/** Whether the stream was blocked by a permission rejection. */
	blocked: boolean
	/** Whether compaction is needed (context overflow detected). */
	needsCompaction: boolean
}

interface StreamEvent {
	type: string
	[key: string]: any
}

export interface ProcessStreamParams {
	sessionId: string
	messageId: string
	createStream: () => Promise<{ fullStream: AsyncIterable<StreamEvent> }>
	signal: AbortSignal
	agent: string
	tools: Map<string, { shape: Tool.Shape; definition: Tool.ToolDefinition }>
	ruleset: PermissionRuleset
	messages: any[]
	modelRef?: { modelId: string; providerId: string }
	pricing?: Pricing
	contextWindow: number
	maxOutput: number
	onStepFinish?: (usage: StepUsage) => void
}

/**
 * Process the AI SDK fullStream, handling all event types.
 *
 * Wraps stream consumption in an inner retry loop: transient errors trigger
 * a fresh stream via `createStream()`, context overflow signals compaction
 * to the main loop, and fatal errors break immediately.
 *
 * Permission checking is delegated to the tools themselves via ctx.ask().
 * The stream processor catches permission errors (DeniedError, RejectedError,
 * CorrectedError) and records them as tool errors.
 *
 * When a user rejects a permission request, the loop is blocked and stops.
 */
export async function processStream(params: ProcessStreamParams): Promise<StreamResult> {
	const {
		sessionId,
		messageId,
		createStream,
		signal,
		agent,
		tools,
		ruleset,
		messages,
		contextWindow,
		maxOutput,
	} = params

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

	const MAX_RETRY_ATTEMPTS = 5

	let finishReason = "stop"
	let blocked = false
	let needsCompactionFlag = false
	const totalUsage: StepUsage = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 }
	let totalCost = 0
	let currentStepStartHash: string | undefined
	let estimatedToolOutputTokens = 0

	// Per-step usage for accurate overflow detection. Each step's inputTokens
	// already includes all prior context, so we track the latest step's values
	// rather than accumulating (which would double-count).
	let lastStepInput = 0
	let lastStepOutput = 0
	let lastStepReasoning = 0

	/** Persist accumulated text and reset accumulators. No-op if empty. */
	function flushText(): void {
		if (!currentText || !textPartId) return
		const id = textPartId
		const partData = { type: "text" as const, text: currentText }
		Database.withEffects((_tx, effect) => {
			queries.upsertPart({ id, sessionId, messageId, type: "text", data: partData })
			effect(() => {
				bus().emit("part:upsert", { sessionId, messageId, part: { id, ...partData } })
			})
		})
		currentText = ""
		textPartId = undefined
	}

	/** Persist accumulated reasoning with timing and reset accumulators. No-op if empty. */
	function flushReasoning(): void {
		if (!currentReasoning || !reasoningPartId) return
		const id = reasoningPartId
		const partData = {
			type: "reasoning" as const,
			text: currentReasoning,
			time: { start: reasoningStartTime ?? Date.now(), end: Date.now() },
		}
		Database.withEffects((_tx, effect) => {
			queries.upsertPart({ id, sessionId, messageId, type: "reasoning", data: partData })
			effect(() => {
				bus().emit("part:upsert", { sessionId, messageId, part: { id, ...partData } })
			})
		})
		currentReasoning = ""
		reasoningPartId = undefined
		reasoningStartTime = undefined
	}

	/**
	 * Mark any in-flight tools as errors on unexpected exit.
	 * Scans remaining correlation entries and sets status="error" with a
	 * descriptive message. This handles both
	 * user-initiated abort and unexpected stream termination.
	 */
	function cleanupPendingTools(): void {
		for (const [callId, correlation] of toolCorrelation) {
			const errorMsg = signal.aborted
				? "Tool execution aborted"
				: "Stream interrupted before tool completed"

			persistToolError(
				correlation.partId,
				sessionId,
				messageId,
				callId,
				correlation.toolName,
				correlation.input ?? {},
				errorMsg,
				correlation.startTime,
			)
		}
		toolCorrelation.clear()
	}

	// Inner retry loop — re-creates the stream on transient errors
	let attempt = 0

	// eslint-disable-next-line no-constant-condition
	while (true) {
		if (signal.aborted) break

		try {
			const { fullStream } = await createStream()

			for await (const event of fullStream) {
				if (signal.aborted || blocked || needsCompactionFlag) break

				switch (event.type) {
					case "start": {
						break
					}

					case "start-step": {
						const snapshotManager = await snapshot()
						const hash = await snapshotManager.capture()
						currentStepStartHash = hash

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
						// Reserve the part's position in msg.parts at text-start time
						// by both persisting an empty text row (locks its DB ordinal
						// before any tool-input-start upsert can beat it) and emitting
						// a placeholder delta for the live client. Without the DB
						// reservation, the text row is first inserted at text-end /
						// finish-step, after any tool already got a lower ordinal —
						// parts then flip order on reload.
						{
							const id = textPartId
							const partData = { type: "text" as const, text: "" }
							Database.withEffects((_tx, effect) => {
								queries.upsertPart({
									id,
									sessionId,
									messageId,
									type: "text",
									data: partData,
								})
								effect(() => {
									bus().emit("part:delta", {
										sessionId,
										messageId,
										partId: id,
										delta: "",
										partType: "text",
									})
								})
							})
						}
						break
					}

					case "text-delta": {
						currentText += event.text
						bus().emit("part:delta", {
							sessionId,
							messageId,
							partId: textPartId!,
							delta: event.text,
							partType: "text",
						})
						break
					}

					case "text-end": {
						flushText()
						break
					}

					case "reasoning-start": {
						currentReasoning = ""
						reasoningStartTime = Date.now()
						reasoningPartId = ulid()
						// Same DB-ordinal + placeholder reservation as text-start.
						{
							const id = reasoningPartId
							const partData = {
								type: "reasoning" as const,
								text: "",
								time: { start: reasoningStartTime },
							}
							Database.withEffects((_tx, effect) => {
								queries.upsertPart({
									id,
									sessionId,
									messageId,
									type: "reasoning",
									data: partData,
								})
								effect(() => {
									bus().emit("part:delta", {
										sessionId,
										messageId,
										partId: id,
										delta: "",
										partType: "reasoning",
									})
								})
							})
						}
						break
					}

					case "reasoning-delta": {
						currentReasoning += event.text
						bus().emit("part:delta", {
							sessionId,
							messageId,
							partId: reasoningPartId!,
							delta: event.text,
							partType: "reasoning",
						})
						break
					}

					case "reasoning-end": {
						flushReasoning()
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
							toolName,
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

						// Update correlation with parsed input for cleanup
						if (correlation) correlation.input = args

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
							setSessionStatus(sessionId, "awaiting-permission")
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
							// Accumulate streaming metadata pushed via ctx.metadata() so
							// it isn't clobbered by the completion upsert below. Without
							// this, tools that surface rich data mid-execution (e.g.
							// plan_exit's planContent) lose those fields when the final
							// result.metadata is persisted on completion.
							const accumulatedMetadata: Record<string, unknown> = {}
							const ctx = createToolContext({
								sessionId,
								messageId,
								agent,
								signal,
								callId,
								partId,
								toolName,
								messages,
								ruleset,
								modelRef: params.modelRef,
								onMetadata: (m) => {
									Object.assign(accumulatedMetadata, m)
								},
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
									signal,
									metadata: {
										reason: `Doom loop detected: ${toolName} called 3 times with identical arguments`,
									},
								})
								setSessionStatus(sessionId, "busy")
							}

							const result = await toolEntry.definition.execute(ctx, args)

							// Remove from correlation map — tool completed successfully
							toolCorrelation.delete(callId)

							// Merge accumulated streaming metadata with the final result
							// metadata. result.metadata wins on conflicts because the tool
							// may have intentionally cleared/updated a field at the end.
							const mergedMetadata =
								Object.keys(accumulatedMetadata).length > 0
									? { ...accumulatedMetadata, ...(result.metadata ?? {}) }
									: result.metadata

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
										metadata: mergedMetadata,
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
											metadata: mergedMetadata,
										},
									})
								})
							})

							// Track estimated token cost of tool output for pre-emptive
							// overflow detection. Catches the batch-reads-large-files
							// scenario BEFORE the next API call overflows.
							const outputLen = (result.output ?? "").length
							estimatedToolOutputTokens += Math.ceil(outputLen / CHARS_PER_TOKEN)

							// Project next call's input from last step's actual usage
							// (not cumulative totalUsage which double-counts context).
							const projectedInput =
								lastStepInput + lastStepOutput + lastStepReasoning + estimatedToolOutputTokens
							if (needsCompaction(projectedInput, contextWindow, maxOutput)) {
								needsCompactionFlag = true
							}
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
								toolCorrelation.delete(callId)
								blocked = true // Stop processing — user rejected
								setSessionStatus(sessionId, "idle")
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
								toolCorrelation.delete(callId)
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
							toolCorrelation.delete(callId)
						}
						break
					}

					case "tool-result": {
						const callId = event.toolCallId as string
						const correlation = toolCorrelation.get(callId)

						// Skip if correlation is missing — the tool was already handled
						// by local execution in the tool-call case. Creating a new part
						// with ulid() here would produce a duplicate.
						if (!correlation) break

						const partId = correlation.partId
						const output =
							typeof event.output === "string" ? event.output : JSON.stringify(event.output)

						toolCorrelation.delete(callId)

						Database.withEffects((_tx, effect) => {
							queries.upsertPart({
								id: partId,
								sessionId,
								messageId,
								type: "tool",
								data: {
									type: "tool",
									callId,
									tool: event.toolName ?? correlation.toolName,
									state: "completed",
									output,
									time: {
										start: correlation.startTime,
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
										tool: event.toolName ?? correlation.toolName,
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

						// Skip if correlation is missing — the tool was already handled
						// by local execution in the tool-call case.
						if (!correlation) break

						const partId = correlation.partId
						const errorMessage = typeof event.error === "string" ? event.error : String(event.error)

						toolCorrelation.delete(callId)

						Database.withEffects((_tx, effect) => {
							queries.upsertPart({
								id: partId,
								sessionId,
								messageId,
								type: "tool",
								data: {
									type: "tool",
									callId,
									tool: event.toolName ?? correlation.toolName,
									state: "error",
									error: errorMessage,
									time: {
										start: correlation.startTime,
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
										tool: event.toolName ?? correlation.toolName,
										state: "error",
										error: errorMessage,
									},
								})
							})
						})
						break
					}

					case "finish-step": {
						// Flush accumulated text and reasoning before finishing step
						flushText()
						flushReasoning()

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

						// Compute cost for this step
						const stepCost =
							usage && params.pricing ? computeStepCost(usage, params.pricing) : undefined
						if (stepCost !== undefined) {
							totalCost += stepCost
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
									cost: stepCost,
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
										cost: stepCost,
										snapshot: postHash,
										sources: currentSources.length > 0 ? currentSources : undefined,
									},
								})
							})
						})

						// Emit EditPart if files changed in this step
						if (!currentStepStartHash) {
							log.warn("EditPart skipped: no start-step hash", { sessionId, messageId })
						} else if (!postHash) {
							log.warn("EditPart skipped: post-step capture failed", { sessionId, messageId })
						} else if (currentStepStartHash === postHash) {
							log.debug("EditPart skipped: hashes identical", { sessionId, messageId })
						} else {
							let fileDiffs: Array<{
								path: string
								additions: number
								deletions: number
								status: string
							}> = []
							try {
								fileDiffs = await snapshotManager.diffStats(currentStepStartHash, postHash)
							} catch (err) {
								log.error("EditPart: diffStats threw", {
									sessionId,
									messageId,
									startHash: currentStepStartHash,
									endHash: postHash,
									error: err instanceof Error ? err.message : String(err),
								})
							}

							// Fallback: if diffStats returned empty but hashes differ,
							// try changedFiles (--name-only, more resilient)
							if (fileDiffs.length === 0) {
								const fallbackFiles = await snapshotManager.changedFiles(
									currentStepStartHash,
									postHash,
								)
								if (fallbackFiles.length > 0) {
									log.warn("EditPart: using changedFiles fallback", {
										sessionId,
										messageId,
										fileCount: fallbackFiles.length,
									})
									fileDiffs = fallbackFiles.map((path) => ({
										path,
										additions: 0,
										deletions: 0,
										status: "modified",
									}))
								}
							}

							if (fileDiffs.length > 0) {
								const editPartId = ulid()
								const editData = {
									type: "edit" as const,
									hash: currentStepStartHash!,
									files: fileDiffs.map((f) => ({
										path: f.path,
										additions: f.additions,
										deletions: f.deletions,
										status: f.status as "added" | "deleted" | "modified",
									})),
									totalAdditions: fileDiffs.reduce((s, f) => s + f.additions, 0),
									totalDeletions: fileDiffs.reduce((s, f) => s + f.deletions, 0),
								}
								Database.withEffects((_tx, effect) => {
									queries.upsertPart({
										id: editPartId,
										sessionId,
										messageId,
										type: "edit",
										data: editData,
									})
									effect(() => {
										bus().emit("part:upsert", {
											sessionId,
											messageId,
											part: { id: editPartId, ...editData },
										})
									})
								})
							}
						}
						currentStepStartHash = undefined

						// Emit accumulated session usage for the frontend
						bus().emit("session:usage", {
							sessionId,
							usage: { ...totalUsage },
							cost: totalCost,
							contextWindow,
						})

						currentSources = []
						params.onStepFinish?.(usage ?? { input: 0, output: 0 })

						// Update per-step tracking for accurate overflow detection.
						// Reset tool output estimate: prior tool outputs are already
						// reflected in this step's inputTokens.
						if (usage) {
							lastStepInput = usage.input ?? 0
							lastStepOutput = usage.output ?? 0
							lastStepReasoning = usage.reasoning ?? 0
						}
						estimatedToolOutputTokens = 0

						const currentTotal = lastStepInput + lastStepOutput + lastStepReasoning
						if (needsCompaction(currentTotal, contextWindow, maxOutput)) {
							needsCompactionFlag = true
						}
						break
					}

					case "finish": {
						finishReason = (event.finishReason as string) ?? "stop"
						break
					}

					case "error": {
						const errorMessage =
							event.error instanceof Error ? event.error.message : String(event.error)
						log.error("Stream error event", { sessionId, error: errorMessage })

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
									attempt,
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
										attempt,
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
						log.warn("Unknown event type", {
							sessionId,
							eventType: event.type,
						})
						break
					}
				}
			}

			// Stream consumed successfully (or broke out due to compaction/block/abort).
			// Reset attempt counter on success.
			attempt = 0
		} catch (error) {
			// Abort errors are not retryable
			if (signal.aborted) break

			const classified = classifyError(error)

			if (classified.type === "context_overflow") {
				needsCompactionFlag = true
				// Don't retry — exit to trigger compaction in the main loop
			} else if (classified.type === "retryable" && attempt < MAX_RETRY_ATTEMPTS) {
				attempt++
				const headers = extractResponseHeaders(error)
				const delay = retryDelay(attempt, headers)

				log.warn("Retrying stream", {
					sessionId,
					attempt,
					delay,
					error: error instanceof Error ? error.message : String(error),
				})

				setSessionStatus(sessionId, {
					type: "retry",
					attempt,
					message: classified.message,
					next: Date.now() + delay,
				})

				// Persist retry event
				const retryPartId = ulid()
				Database.withEffects((_tx, effect) => {
					queries.upsertPart({
						id: retryPartId,
						sessionId,
						messageId,
						type: "retry",
						data: {
							type: "retry",
							error: error instanceof Error ? error.message : String(error),
							attempt,
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
								error: error instanceof Error ? error.message : String(error),
								attempt,
								timestamp: Date.now(),
							},
						})
					})
				})

				// Flush any partial content before retrying
				flushText()
				flushReasoning()

				await retrySleep(delay, signal).catch(() => {
					// Abort during sleep is fine — we'll break on the next iteration
				})
				continue // Re-create stream and retry
			} else {
				// Fatal or retries exhausted — store error and break
				const errorMessage = error instanceof Error ? error.message : String(error)
				log.error("Fatal stream error", { sessionId, error: errorMessage, attempt })

				const errorPartId = ulid()
				Database.withEffects((_tx, effect) => {
					queries.upsertPart({
						id: errorPartId,
						sessionId,
						messageId,
						type: "retry",
						data: {
							type: "retry",
							error: errorMessage,
							attempt,
							timestamp: Date.now(),
						},
					})

					effect(() => {
						bus().emit("part:upsert", {
							sessionId,
							messageId,
							part: {
								id: errorPartId,
								type: "retry",
								error: errorMessage,
								attempt,
								timestamp: Date.now(),
							},
						})
					})
				})
			}
		}

		// Cleanup pending tools and flush partial content on all exit paths
		cleanupPendingTools()
		flushText()
		flushReasoning()
		break
	}

	return {
		finishReason,
		usage: totalUsage,
		cost: totalCost,
		blocked,
		needsCompaction: needsCompactionFlag,
	}
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

/**
 * Extract response headers from error objects.
 * Handles AI SDK errors, ProviderError, and generic error objects
 * that may expose headers in various formats.
 */
function extractResponseHeaders(error: unknown): Record<string, string> | undefined {
	if (!error || typeof error !== "object") return undefined

	// AI SDK errors with responseHeaders as a plain object
	if ("responseHeaders" in error) {
		const h = (error as any).responseHeaders
		if (h && typeof h === "object" && !(h instanceof Headers)) {
			return h as Record<string, string>
		}
		// Convert Headers instance to Record
		if (h instanceof Headers) {
			const record: Record<string, string> = {}
			h.forEach((value, key) => {
				record[key] = value
			})
			return record
		}
	}

	// Generic errors with a headers property
	if ("headers" in error) {
		const h = (error as any).headers
		if (h instanceof Headers) {
			const record: Record<string, string> = {}
			h.forEach((value, key) => {
				record[key] = value
			})
			return record
		}
		if (h && typeof h === "object") {
			return h as Record<string, string>
		}
	}

	return undefined
}
