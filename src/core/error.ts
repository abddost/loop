/**
 * Base application error with structured error code and HTTP status.
 */
export class AppError extends Error {
	readonly code: string
	readonly statusCode: number
	readonly cause?: Error

	constructor(message: string, opts: { code: string; statusCode?: number; cause?: Error }) {
		super(message)
		this.name = "AppError"
		this.code = opts.code
		this.statusCode = opts.statusCode ?? 500
		this.cause = opts.cause
	}
}

/**
 * Error from an LLM provider with retry information.
 */
export class ProviderError extends AppError {
	readonly retryable: boolean
	readonly retryAfter?: number

	constructor(
		message: string,
		opts: {
			code: string
			statusCode?: number
			cause?: Error
			retryable: boolean
			retryAfter?: number
		},
	) {
		super(message, opts)
		this.name = "ProviderError"
		this.retryable = opts.retryable
		this.retryAfter = opts.retryAfter
	}
}

/**
 * Error during tool execution.
 */
export class ToolError extends AppError {
	readonly toolId: string

	constructor(
		message: string,
		opts: { code: string; statusCode?: number; cause?: Error; toolId: string },
	) {
		super(message, opts)
		this.name = "ToolError"
		this.toolId = opts.toolId
	}
}

/**
 * Error from schema validation failures.
 */
export class ValidationError extends AppError {
	constructor(message: string, opts?: { cause?: Error }) {
		super(message, {
			code: "VALIDATION_ERROR",
			statusCode: 400,
			cause: opts?.cause,
		})
		this.name = "ValidationError"
	}
}

/**
 * Error related to workspace context operations.
 */
export class WorkspaceError extends AppError {
	constructor(message: string, opts?: { code?: string; statusCode?: number; cause?: Error }) {
		super(message, {
			code: opts?.code ?? "WORKSPACE_ERROR",
			statusCode: opts?.statusCode ?? 500,
			cause: opts?.cause,
		})
		this.name = "WorkspaceError"
	}
}

/**
 * Detect if an error indicates context window overflow.
 * Non-retryable — should trigger compaction instead.
 */
export function isContextOverflow(error: unknown): boolean {
	if (error instanceof ProviderError && error.code === "CONTEXT_OVERFLOW") return true
	const msg = String((error as any)?.message ?? "")
	return (
		/context.*(length|window|limit|overflow)/i.test(msg) ||
		/maximum.*token/i.test(msg) ||
		/prompt.*too.*long/i.test(msg)
	)
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503])

/**
 * Checks whether an error is retryable based on status code or ProviderError flag.
 * Handles AppError subclasses, AI SDK errors with a status property, and
 * any error with a numeric statusCode or status field.
 * @param error - The error to check
 * @returns True if the error is retryable
 */
export function isRetryable(error: unknown): boolean {
	if (error instanceof ProviderError) {
		return error.retryable
	}
	if (error instanceof AppError) {
		return RETRYABLE_STATUS_CODES.has(error.statusCode)
	}
	// Handle AI SDK and other errors that expose an HTTP status code
	if (error && typeof error === "object") {
		const status =
			(error as any).status ?? (error as any).statusCode ?? (error as any).response?.status
		if (typeof status === "number") {
			return RETRYABLE_STATUS_CODES.has(status)
		}
	}
	return false
}
