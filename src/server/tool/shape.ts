import type { z } from "zod"

export namespace Tool {
	export interface Shape {
		id: string
		init(agent?: string): ToolDefinition
	}

	export interface ToolDefinition {
		description: string
		parameters: z.ZodType<any>
		execute(ctx: Context, input: any): Promise<ToolResult>
	}

	export interface Context {
		sessionId: string
		messageId: string
		agent: string
		signal: AbortSignal
		callId: string
		extra?: Record<string, any>
		messages: any[]
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
}
