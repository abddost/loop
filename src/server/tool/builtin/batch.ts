import { ulid } from "@core/id"
import { z } from "zod"
import { bus } from "../../workspace/bus"
import type { Tool } from "../shape"

const MAX_CALLS = 25
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

				const results = await Promise.all(
					accepted.map(async (call, index) => {
						const partId = ulid()
						const callId = ulid()
						const startTime = Date.now()

						// Validate: no nested batch
						if (DISALLOWED.has(call.tool)) {
							emitToolState(ctx, partId, callId, call.tool, "error", {
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
							emitToolState(ctx, partId, callId, call.tool, "error", {
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

						const definition = shape.init(ctx.agent)

						// Emit running state
						emitToolState(ctx, partId, callId, call.tool, "running", {
							input: call.parameters,
							startTime,
						})

						try {
							const result = await definition.execute(
								{
									...ctx,
									callId,
									metadata(metaInput) {
										bus().emit("part:upsert", {
											sessionId: ctx.sessionId,
											messageId: ctx.messageId,
											part: {
												id: partId,
												type: "tool",
												metadata: metaInput,
											},
										})
									},
								},
								call.parameters,
							)

							// Emit completed state
							emitToolState(ctx, partId, callId, call.tool, "completed", {
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

							emitToolState(ctx, partId, callId, call.tool, "error", {
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

function emitToolState(
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
	bus().emit("part:upsert", {
		sessionId: ctx.sessionId,
		messageId: ctx.messageId,
		part: {
			id: partId,
			type: "tool",
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
		},
	})
}
