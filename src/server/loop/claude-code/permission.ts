import type { PermissionRuleset } from "@core/schema/permission"
import * as Database from "../../db"
import * as queries from "../../db/queries"
import { createLogger } from "../../logger"
import { ask } from "../../permission/permission"
import { CorrectedError, DeniedError, RejectedError } from "../../permission/types"
import { bus } from "../../workspace/bus"
import { askPlanApproval } from "./plan-approval"
import type { SdkPermissionMode } from "./prompts"

/**
 * Bridge between the Claude Agent SDK's `canUseTool` callback and Loop's
 * permission system.
 *
 * The SDK calls `canUseTool` concurrently for parallel tool calls. We
 * delegate each call to the same `ask()` entrypoint the stream processor
 * uses, so the existing UI (permission pills, "always allow" rules,
 * session-scoped approvals) all keep working. Bus events key on the
 * permission request `id`, so we prefix everything with `cc:` to avoid
 * collisions with AI SDK `callId`s when a session has a mix of both.
 */

const log = createLogger("claude-code-permission")

/** SDK's PermissionResult shape — kept loose to avoid coupling to a
 *  specific SDK version. */
export type PermissionResult =
	| { behavior: "allow"; updatedInput: Record<string, unknown> }
	| { behavior: "deny"; message: string; interrupt?: boolean }

/** The SDK-facing shape of `canUseTool`. */
export type CanUseToolFn = (
	toolName: string,
	toolInput: Record<string, unknown>,
	options: { signal?: AbortSignal; toolUseID?: string; suggestions?: unknown },
) => Promise<PermissionResult>

/** Mutable reference to the SDK query, set after query() is called. */
export interface QueryRef {
	setPermissionMode?: (mode: SdkPermissionMode) => Promise<void>
}

interface MakeCanUseToolOptions {
	sessionId: string
	/** Agent-resolved ruleset (built once per turn by the runtime). */
	ruleset: PermissionRuleset
	/** Session-level bypass — `true` for "full-access" sessions. */
	bypass: boolean
	/** Turn-level abort signal. Individual tool signals are ANDed with this. */
	turnSignal: AbortSignal
	/** Mutable ref to the SDK query — populated after query() starts. */
	queryRef?: QueryRef
	/**
	 * Called when ExitPlanMode is intercepted with the plan content from the
	 * SDK-enriched tool input. The adapter uses this to attach plan metadata
	 * to the tool part so the frontend can render the plan card.
	 */
	onPlanContent?: (toolUseId: string, plan: string) => void
}

/**
 * Build a `canUseTool` callback for one Claude Code turn.
 *
 * The returned function is safe to call concurrently — each invocation owns
 * its own deferred promise inside the permission module. Errors from
 * `ask()` are translated to SDK-shaped `{behavior: "deny"}` results so the
 * SDK can report them back on the timeline.
 */
export function makeCanUseTool(opts: MakeCanUseToolOptions): CanUseToolFn {
	const { sessionId, ruleset, bypass, turnSignal, queryRef, onPlanContent } = opts

	return async (toolName, toolInput, options) => {
		if (bypass) {
			return { behavior: "allow", updatedInput: toolInput }
		}

		// Combine the SDK's per-tool signal with the turn-level abort so a
		// session cancel reliably unblocks parallel tool waits.
		const mergedSignal = mergeSignals(turnSignal, options.signal)

		// ── ExitPlanMode: plan approval flow ────────────────────────
		// ExitPlanMode is a plan proposal, not a normal tool call. We show
		// a dedicated approval dialog with "Accept" / "Accept, allow edits"
		// / "Revise" options, then switch the SDK permission mode based on
		// the user's choice.
		//
		// The SDK enriches the tool input with a `plan` field that contains
		// the full plan markdown. This field is NOT in the streaming
		// content_block events — it's only available here in canUseTool.
		// We extract it and forward to the adapter so the frontend can
		// render the plan card.
		if (toolName === "ExitPlanMode") {
			const toolUseId = options.toolUseID
			if (onPlanContent && toolUseId) {
				const plan = typeof toolInput.plan === "string" ? toolInput.plan.trim() : undefined
				if (plan) {
					onPlanContent(toolUseId, plan)
				}
			}
			return handlePlanApproval(sessionId, toolInput, mergedSignal, queryRef)
		}

		// ── Normal tool permission check ────────────────────────────
		const mapped = mapToolToPermission(toolName, toolInput)

		const toolUseId = options.toolUseID ?? `cc-${Date.now()}-${Math.random().toString(36).slice(2)}`
		const requestId = `cc:${sessionId}:${toolUseId}`

		try {
			await ask({
				id: requestId,
				sessionId,
				permission: mapped.permission,
				patterns: mapped.patterns,
				always: mapped.always,
				ruleset,
				signal: mergedSignal,
				metadata: {
					tool: toolName,
					input: toolInput,
					reason: `Claude Code wants to use ${toolName}`,
				},
			})
			return { behavior: "allow", updatedInput: toolInput }
		} catch (err) {
			return translatePermissionError(err, toolName)
		}
	}
}

/**
 * Handle the ExitPlanMode tool as a plan approval request.
 *
 * Shows a plan approval dialog, waits for the user's decision, then
 * switches the SDK permission mode accordingly:
 *   - "once"   → Accept (switch to "default" — ask permissions)
 *   - "always" → Accept, allow edits (switch to "acceptEdits")
 *   - "reject" → Revise (deny with feedback)
 */
async function handlePlanApproval(
	sessionId: string,
	toolInput: Record<string, unknown>,
	signal: AbortSignal,
	queryRef?: QueryRef,
): Promise<PermissionResult> {
	const requestId = `cc:plan:${sessionId}:${Date.now()}`

	try {
		const replyType = await askPlanApproval(requestId, sessionId, signal)

		// Map reply to SDK permission mode for implementation phase.
		const implementationMode: SdkPermissionMode = replyType === "always" ? "acceptEdits" : "default"

		// Switch the running query's permission mode so the SDK continues
		// in implementation mode after ExitPlanMode executes.
		if (queryRef?.setPermissionMode) {
			try {
				await queryRef.setPermissionMode(implementationMode)
			} catch (err) {
				log.warn("Failed to set permission mode after plan approval", {
					sessionId,
					mode: implementationMode,
					error: err instanceof Error ? err.message : String(err),
				})
			}
		}

		// Persist the new session permission mode and notify the frontend.
		const sessionMode = implementationMode === "acceptEdits" ? "auto-accept-edits" : "default"
		Database.withEffects((_tx, effect) => {
			queries.updateSession(sessionId, { permissionMode: sessionMode })
			effect(() => {
				bus().emit("session:update", {
					sessionId,
					session: queries.findSessionById(sessionId),
				})
			})
		})

		return { behavior: "allow", updatedInput: toolInput }
	} catch (err) {
		return translatePermissionError(err, "ExitPlanMode")
	}
}

/**
 * Translate permission errors to SDK deny results.
 *
 * IMPORTANT: Never set `interrupt: true` — the SDK treats interrupted
 * denials as hard errors and emits an `ede_diagnostic` error result.
 * Instead, return a plain deny with the message so Claude receives the
 * feedback gracefully and can act on it in the next turn.
 */
function translatePermissionError(err: unknown, toolName: string): PermissionResult {
	if (err instanceof DeniedError) {
		return { behavior: "deny", message: err.message }
	}
	if (err instanceof RejectedError) {
		return {
			behavior: "deny",
			message: err.message || "User rejected the tool call",
		}
	}
	if (err instanceof CorrectedError) {
		return {
			behavior: "deny",
			message: err.message,
		}
	}
	// Abort during wait — treat as deny without interrupting again
	// (the session already aborted, SDK will tear down on its own).
	if (err instanceof Error && err.message === "aborted") {
		return { behavior: "deny", message: "Tool cancelled by user" }
	}

	log.error("canUseTool unexpected error", {
		toolName,
		error: err instanceof Error ? err.message : String(err),
	})
	return {
		behavior: "deny",
		message: err instanceof Error ? err.message : "Permission check failed",
	}
}

/** Merge two abort signals into one that fires when either fires. */
function mergeSignals(a: AbortSignal, b?: AbortSignal): AbortSignal {
	if (!b) return a
	if (a.aborted) return a
	if (b.aborted) return b

	const controller = new AbortController()
	const forward = (target: AbortSignal) => () => {
		if (!controller.signal.aborted) controller.abort(target.reason)
	}
	const aHandler = forward(a)
	const bHandler = forward(b)
	a.addEventListener("abort", aHandler, { once: true })
	b.addEventListener("abort", bHandler, { once: true })
	// Best-effort cleanup when the caller aborts via either source —
	// listeners don't leak because `once: true` removes them automatically.
	return controller.signal
}

/**
 * Translate an SDK tool name + input into the shape `ask()` expects.
 *
 * We map each Claude Code built-in tool to one of Loop's permission
 * categories (`edit`, `bash`, `read`, `web`, `other`). Patterns are the
 * concrete values to check (file paths, bash commands), and `always`
 * contains broader wildcards the user can approve with "always allow".
 */
function mapToolToPermission(
	toolName: string,
	input: Record<string, unknown>,
): {
	permission: string
	patterns: string[]
	always: string[]
} {
	const filePath =
		typeof input.file_path === "string"
			? input.file_path
			: typeof input.path === "string"
				? input.path
				: undefined

	switch (toolName) {
		case "Edit":
		case "Write":
		case "MultiEdit":
		case "NotebookEdit": {
			const patterns = filePath ? [filePath] : ["*"]
			return {
				permission: "edit",
				patterns,
				always: filePath ? [dirnameGlob(filePath)] : ["*"],
			}
		}
		case "Bash":
		case "BashOutput":
		case "KillBash": {
			const command = typeof input.command === "string" ? input.command : JSON.stringify(input)
			// Patterns include the full command + the bare program name so
			// `ask()` can match prefix-wildcard rules like "git *".
			const program = command.trim().split(/\s+/, 1)[0] ?? command
			return {
				permission: "bash",
				patterns: [command, program],
				always: [`${program} *`],
			}
		}
		case "Read":
		case "Glob":
		case "Grep":
		case "LS":
		case "NotebookRead": {
			const patterns = filePath ? [filePath] : ["*"]
			return {
				permission: "read",
				patterns,
				always: filePath ? [dirnameGlob(filePath)] : ["*"],
			}
		}
		case "WebFetch":
		case "WebSearch": {
			const url = typeof input.url === "string" ? input.url : "*"
			return {
				permission: "web",
				patterns: [url],
				always: [originGlob(url)],
			}
		}
		default: {
			return {
				permission: "other",
				patterns: [toolName],
				always: [toolName],
			}
		}
	}
}

/** Convert a file path to a directory wildcard for "always allow" scope. */
function dirnameGlob(path: string): string {
	const lastSlash = path.lastIndexOf("/")
	if (lastSlash < 0) return "*"
	return `${path.slice(0, lastSlash)}/*`
}

/** Convert a URL to its origin for "always allow" scope. */
function originGlob(url: string): string {
	try {
		const u = new URL(url)
		return `${u.protocol}//${u.host}/*`
	} catch {
		return "*"
	}
}
