import type { z } from "zod"

export namespace Tool {
	/** The shape every tool must conform to. */
	export interface Shape {
		/** Unique tool identifier (e.g., "bash", "edit", "read") */
		id: string
		/** Lazy factory called when the tool is needed. Returns tool definition. */
		init(agent?: string): ToolDefinition
	}

	export interface ToolDefinition {
		/** Natural language description shown to the LLM */
		description: string
		/** Zod schema that validates LLM input */
		parameters: z.ZodType<any>
		/** Execute the tool */
		execute(ctx: Context, input: any): Promise<ToolResult>
	}

	export interface Context {
		/** Current session ID */
		sessionId: string
		/** Current message ID (assistant message being built) */
		messageId: string
		/** Current agent name */
		agent: string
		/** Abort signal for cancellation */
		signal: AbortSignal
		/** Tool call ID from the LLM */
		callId: string
		/** Extra context data */
		extra?: Record<string, any>
		/** All messages in current session (for context) */
		messages: any[]
		/**
		 * Send live streaming updates to the UI while the tool runs.
		 * Used by tools like bash to stream output in real time.
		 */
		metadata(input: { title?: string; metadata?: any }): void
		/**
		 * Request permission from the user. Blocks until user responds.
		 * This is the entire permission system entry point.
		 */
		ask(input: PermissionAskInput): Promise<boolean>
	}

	export interface ToolResult {
		output: string
		metadata?: Record<string, unknown>
	}

	export interface PermissionAskInput {
		reason?: string
		type?: "tool" | "doom_loop"
	}
}
