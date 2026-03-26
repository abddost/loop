import { ulid } from "@core/id"
import { z } from "zod"
import * as Database from "../../db"
import * as queries from "../../db/queries"
import { evaluate } from "../../permission/evaluate"
import { ask as permissionAsk, permissionState } from "../../permission/permission"
import { CorrectedError, DeniedError, RejectedError } from "../../permission/types"
import { bus } from "../../workspace/bus"
import type { Tool } from "../shape"

const MAX_CALLS = 6
const DISALLOWED = new Set(["batch"])

/** Execute multiple tool calls in parallel. */
export const batchTool: Tool.Shape = {
	id: "batch",
	init() {
		return {
			description: `Run up to ${MAX_CALLS} tool calls in parallel. Each call specifies a tool name and its parameters. Useful for performing independent operations concurrently (e.g., reading multiple files, running multiple searches). Nested batch calls are not allowed.`,
			parameters: z.object({
				tool_calls: z
					.array(
						z.object({
							tool: z.string().describe("Name of the tool to call"),
							parameters: z.record(z.unknown()).describe("Parameters to pass to the tool"),
						}),
					)
					.min(1)
					.describe("Array of tool calls to execute in parallel"),
			}),
			async execute(ctx, input) {
				const calls: Array<{ tool: string; parameters: Record<string, unknown> }> = input.tool_calls

				// Discard extras beyond MAX_CALLS
				const accepted = calls.slice(0, MAX_CALLS)
				const discarded = calls.length - accepted.length

				// Lazy import to avoid circular dependency at module load
				const { ToolRegistry } = await import("../registry")

				// ── Permission pre-check ──────────────────────────────
				// Group calls by tool type and ask permission once per type.
				// This avoids N identical dialogs for N identical tool calls.
				const batchApproved = new Set<string>()
				const batchDenied = new Set<string>()
				const ruleset = ctx.ruleset ?? []
				const sessionApproved = permissionState().sessionApproved.get(ctx.sessionId) ?? []

				// Group accepted calls by tool name (= permission type)
				const permissionGroups = new Map<
					string,
					Array<{ index: number; params: Record<string, unknown> }>
				>()
				for (let i = 0; i < accepted.length; i++) {
					const call = accepted[i]
					if (DISALLOWED.has(call.tool) || !ToolRegistry.get(call.tool)) continue
					const group = permissionGroups.get(call.tool) ?? []
					group.push({ index: i, params: call.parameters })
					permissionGroups.set(call.tool, group)
				}

				// Pre-check each tool type sequentially
				for (const [toolName, group] of permissionGroups) {
					const patterns: string[] = []
					let hasDeny = false

					for (const { params } of group) {
						const pattern = extractPermissionPattern(toolName, params)
						const rule = evaluate(toolName, pattern, ruleset, sessionApproved)
						if (rule.action === "deny") {
							hasDeny = true
							break
						}
						if (rule.action === "ask") {
							patterns.push(pattern)
						}
						// "allow" → skip
					}

					if (hasDeny) {
						batchDenied.add(toolName)
						continue
					}

					if (patterns.length > 0) {
						try {
							await permissionAsk({
								id: ulid(),
								sessionId: ctx.sessionId,
								permission: toolName,
								patterns,
								always: ["*"],
								ruleset,
								signal: ctx.signal,
								metadata: {
									reason: `Batch: ${group.length} ${toolName} call${group.length !== 1 ? "s" : ""}`,
									batch: true,
									count: group.length,
								},
							})
							batchApproved.add(toolName)
						} catch (err) {
							if (
								err instanceof RejectedError ||
								err instanceof CorrectedError ||
								err instanceof DeniedError
							) {
								batchDenied.add(toolName)
							} else {
								throw err
							}
						}
					} else {
						// All patterns are "allow" — no dialog needed
						batchApproved.add(toolName)
					}
				}

				// ── Execute children in parallel ──────────────────────
				const parentAsk = ctx.ask

				const results = await Promise.all(
					accepted.map(async (call, index) => {
						const partId = ulid()
						const callId = ulid()
						const startTime = Date.now()

						// Validate: no nested batch
						if (DISALLOWED.has(call.tool)) {
							persistToolPart(ctx, partId, callId, call.tool, "error", {
								input: call.parameters,
								error: `Tool "${call.tool}" cannot be called inside batch.`,
								startTime,
							})
							return {
								index,
								tool: call.tool,
								success: false,
								error: `Tool "${call.tool}" cannot be called inside batch.`,
							}
						}

						// Validate: tool exists
						const shape = ToolRegistry.get(call.tool)
						if (!shape) {
							persistToolPart(ctx, partId, callId, call.tool, "error", {
								input: call.parameters,
								error: `Unknown tool: ${call.tool}`,
								startTime,
							})
							return {
								index,
								tool: call.tool,
								success: false,
								error: `Unknown tool: ${call.tool}`,
							}
						}

						// Skip denied/rejected tool types
						if (batchDenied.has(call.tool)) {
							persistToolPart(ctx, partId, callId, call.tool, "error", {
								input: call.parameters,
								error: "Permission denied",
								startTime,
							})
							return {
								index,
								tool: call.tool,
								success: false,
								error: "Permission denied",
							}
						}

						const definition = shape.init(ctx.agent)

						// Persist running state
						persistToolPart(ctx, partId, callId, call.tool, "running", {
							input: call.parameters,
							startTime,
						})

						try {
							const result = await definition.execute(
								{
									...ctx,
									callId,
									metadata(metaInput) {
										Database.withEffects((_tx, effect) => {
											queries.upsertPart({
												id: partId,
												sessionId: ctx.sessionId,
												messageId: ctx.messageId,
												type: "tool",
												data: {
													type: "tool",
													callId,
													tool: call.tool,
													state: "running",
													metadata: metaInput.metadata,
												},
											})
											effect(() => {
												bus().emit("part:upsert", {
													sessionId: ctx.sessionId,
													messageId: ctx.messageId,
													part: {
														id: partId,
														type: "tool",
														callId,
														tool: call.tool,
														state: "running" as const,
														metadata: metaInput.metadata,
													},
												})
											})
										})
									},
									async ask(askInput) {
										// Skip if batch pre-check already approved this permission type
										if (batchApproved.has(askInput.permission)) return
										// Fallback: delegate to parent's ask (generates unique IDs)
										await parentAsk(askInput)
									},
								},
								call.parameters,
							)

							// Persist completed state
							persistToolPart(ctx, partId, callId, call.tool, "completed", {
								input: call.parameters,
								output: result.output,
								metadata: result.metadata,
								startTime,
							})

							return {
								index,
								tool: call.tool,
								success: true,
								output: result.output,
							}
						} catch (err) {
							const errorMessage = err instanceof Error ? err.message : String(err)

							persistToolPart(ctx, partId, callId, call.tool, "error", {
								input: call.parameters,
								error: errorMessage,
								startTime,
							})

							return {
								index,
								tool: call.tool,
								success: false,
								error: errorMessage,
							}
						}
					}),
				)

				const succeeded = results.filter((r) => r.success).length
				const failed = results.filter((r) => !r.success).length

				const lines: string[] = []
				for (const r of results) {
					if (r.success) {
						lines.push(`[${r.index}] ${r.tool}: OK`)
						if (r.output) {
							lines.push(r.output)
						}
					} else {
						lines.push(`[${r.index}] ${r.tool}: FAILED - ${r.error}`)
					}
					lines.push("")
				}

				let summary = `Executed ${succeeded}/${accepted.length} tools successfully.`
				if (failed > 0) summary += ` ${failed} failed.`
				if (discarded > 0) summary += ` ${discarded} calls discarded (max ${MAX_CALLS}).`
				summary +=
					"\n\nContinue to use batch when you have multiple independent operations to perform."

				lines.push(summary)

				return {
					output: lines.join("\n"),
					metadata: { succeeded, failed, discarded, total: accepted.length },
				}
			},
		}
	},
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Persist a child tool part to DB and emit to bus.
 * Follows the same pattern as stream-processor.ts for consistency.
 */
function persistToolPart(
	ctx: Tool.Context,
	partId: string,
	callId: string,
	toolName: string,
	state: "pending" | "running" | "completed" | "error",
	data: {
		input?: Record<string, unknown>
		output?: string
		error?: string
		metadata?: Record<string, unknown>
		startTime: number
	},
): void {
	const partData = {
		type: "tool" as const,
		callId,
		tool: toolName,
		state,
		input: data.input,
		output: data.output,
		error: data.error,
		metadata: data.metadata,
		time: {
			start: data.startTime,
			end: state === "completed" || state === "error" ? Date.now() : undefined,
		},
	}

	Database.withEffects((_tx, effect) => {
		queries.upsertPart({
			id: partId,
			sessionId: ctx.sessionId,
			messageId: ctx.messageId,
			type: "tool",
			data: partData,
		})

		effect(() => {
			bus().emit("part:upsert", {
				sessionId: ctx.sessionId,
				messageId: ctx.messageId,
				part: { id: partId, ...partData },
			})
		})
	})
}

/**
 * Extract the permission-relevant pattern from tool parameters.
 * Maps tool name + parameters to the pattern that tool's ask() would use.
 */
function extractPermissionPattern(tool: string, params: Record<string, unknown>): string {
	switch (tool) {
		case "bash":
			return String(params.command ?? "*")
		case "read":
		case "edit":
		case "write":
		case "multiedit":
		case "apply-patch":
			return String(params.path ?? params.file_path ?? "*")
		case "task":
			return String(params.description ?? "*")
		case "glob":
		case "grep":
			return String(params.pattern ?? "*")
		case "web-fetch":
			return String(params.url ?? "*")
		case "web-search":
			return String(params.query ?? "*")
		case "list":
			return String(params.path ?? ".")
		default:
			return "*"
	}
}
