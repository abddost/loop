import type { PermissionRuleset } from "@core/schema/permission"
import { z } from "zod"

const MAX_OUTPUT_BYTES = 50 * 1024
const MAX_OUTPUT_LINES = 2000

/** Truncate a tool result if it exceeds size limits. */
function truncateResult(result: Tool.ToolResult): Tool.ToolResult {
	if (result.metadata?.truncated) return result

	const encoder = new TextEncoder()
	let output = result.output
	let truncated = false

	// Truncate by byte length
	const bytes = encoder.encode(output)
	if (bytes.byteLength > MAX_OUTPUT_BYTES) {
		const decoder = new TextDecoder()
		output = decoder.decode(bytes.slice(0, MAX_OUTPUT_BYTES))
		truncated = true
	}

	// Truncate by line count
	const lines = output.split("\n")
	if (lines.length > MAX_OUTPUT_LINES) {
		output = lines.slice(0, MAX_OUTPUT_LINES).join("\n")
		truncated = true
	}

	if (truncated) {
		output += "\n...[truncated]"
	}

	return truncated ? { output, metadata: { ...result.metadata, truncated: true } } : result
}

export namespace Tool {
	export interface Shape {
		id: string
		init(agent?: string): ToolDefinition
	}

	export interface ToolDefinition {
		description: string
		parameters: z.ZodType<any>
		execute(ctx: Context, input: any): Promise<ToolResult>
		formatValidationError?(error: z.ZodError): string
		/**
		 * Raw JSON Schema for this tool's parameters.
		 * When set, the AI SDK uses this instead of converting `parameters` to JSON Schema.
		 * Used by MCP tools whose schemas come as JSON Schema from the server.
		 */
		rawInputSchema?: Record<string, unknown>
	}

	export interface Context {
		sessionId: string
		messageId: string
		agent: string
		signal: AbortSignal
		callId: string
		extra?: Record<string, any>
		messages: any[]
		/** Model reference from the current loop iteration. */
		modelRef?: { modelId: string; providerId: string }
		/** Active permission ruleset (needed by batch to construct grouped permission requests). */
		ruleset?: PermissionRuleset
		metadata(input: { title?: string; metadata?: any }): void

		/**
		 * Request permission for a tool action.
		 *
		 * Evaluates the active ruleset:
		 * - "allow" → resolves immediately (no-op)
		 * - "deny"  → throws DeniedError
		 * - "ask"   → blocks until the user responds
		 *
		 * @throws {DeniedError} if the ruleset denies the action
		 * @throws {RejectedError} if the user rejects the request
		 * @throws {CorrectedError} if the user rejects with feedback
		 */
		ask(input: PermissionAskInput): Promise<void>
	}

	export interface ToolResult {
		output: string
		metadata?: Record<string, unknown>
	}

	export interface PermissionAskInput {
		/** Permission type: matches tool name by default, or "doom_loop", etc. */
		permission: string
		/** Specific values to check (file paths, commands). */
		patterns: string[]
		/** Broader patterns for "always allow" option. */
		always: string[]
		/** Extra metadata for the frontend display. */
		metadata?: Record<string, any>
	}

	/** Factory function that wraps tools with automatic validation and output truncation. */
	export function define(
		id: string,
		init: ((agent?: string) => ToolDefinition) | ToolDefinition,
	): Shape {
		return {
			id,
			init(agent?: string) {
				const def = typeof init === "function" ? init(agent) : init
				const originalExecute = def.execute
				def.execute = async (ctx, input) => {
					try {
						def.parameters.parse(input)
					} catch (error) {
						if (error instanceof z.ZodError && def.formatValidationError) {
							throw new Error(def.formatValidationError(error), { cause: error })
						}
						throw new Error(
							`The ${id} tool was called with invalid arguments: ${error}.\nPlease rewrite the input so it satisfies the expected schema.`,
							{ cause: error },
						)
					}
					const result = await originalExecute(ctx, input)
					return truncateResult(result)
				}
				return def
			},
		}
	}
}
