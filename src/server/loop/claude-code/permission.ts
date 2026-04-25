import { ulid } from "@core/id"
import type { PermissionRuleset } from "@core/schema/permission"
import { Deferred } from "@core/util/async"
import * as Database from "../../db"
import * as queries from "../../db/queries"
import { createLogger } from "../../logger"
import { ask } from "../../permission/permission"
import { CorrectedError, DeniedError, RejectedError } from "../../permission/types"
import { bus } from "../../workspace/bus"
import { pendingQuestions } from "../question"
import { setSessionStatus } from "../status"
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
		// Ignore `options.signal` — the SDK fires it for internal reasons
		// (tool supersession, parallel-batch bookkeeping) that race with user
		// approval and turn a benign buzz into a `deny`, causing Claude to
		// retry with a fresh tool_use_id (the "ghost failed tool + apparent
		// duplicate" symptom). Only the session/turn abort unblocks the wait.
		const abortSignal = turnSignal

		// ── AskUserQuestion: always render as a question card ───────
		// The SDK's built-in AskUserQuestion tool has no native prompt in a
		// headless GUI. We intercept here BEFORE any permission check,
		// surface the questions through Loop's existing question-dialog
		// machinery, and return the answers via `updatedInput` so the SDK
		// executes the tool with the user's responses as its arguments.
		// Runs regardless of bypass — clarifying questions must still flow
		// to the UI even in full-access sessions.
		if (toolName === "AskUserQuestion") {
			return askQuestionForSdk(sessionId, toolInput, abortSignal)
		}

		if (bypass) {
			return { behavior: "allow", updatedInput: toolInput }
		}

		// ── Task/Agent subagents: auto-allow explore ───────────────
		// Explore subagents are read-only by definition and the user has
		// asked for them to run without prompting. Other subagent types
		// fall through to the normal permission check below.
		if ((toolName === "Task" || toolName === "Agent") && isExploreSubagent(toolInput)) {
			return { behavior: "allow", updatedInput: toolInput }
		}

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
			return handlePlanApproval(sessionId, toolInput, abortSignal, queryRef)
		}

		// ── Normal tool permission check ────────────────────────────
		const mapped = mapToolToPermission(toolName, toolInput)

		const toolUseId = options.toolUseID ?? `cc-${Date.now()}-${Math.random().toString(36).slice(2)}`
		const requestId = `cc:${sessionId}:${toolUseId}`

		log.info("[canUseTool:start]", {
			toolName,
			toolUseId: options.toolUseID,
			requestId,
			permission: mapped.permission,
			patterns: mapped.patterns,
		})

		try {
			await ask({
				id: requestId,
				sessionId,
				permission: mapped.permission,
				patterns: mapped.patterns,
				always: mapped.always,
				ruleset,
				signal: abortSignal,
				metadata: {
					tool: toolName,
					input: toolInput,
					reason: `Claude Code wants to use ${toolName}`,
				},
			})
			log.info("[canUseTool:return]", {
				toolName,
				toolUseId: options.toolUseID,
				behavior: "allow",
			})
			return { behavior: "allow", updatedInput: toolInput }
		} catch (err) {
			const result = translatePermissionError(err, toolName)
			log.warn("[canUseTool:return]", {
				toolName,
				toolUseId: options.toolUseID,
				behavior: result.behavior,
				message: result.behavior === "deny" ? result.message : undefined,
				errName: err instanceof Error ? err.constructor.name : undefined,
				errMsg: err instanceof Error ? err.message : undefined,
			})
			return result
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

/**
 * Surface the SDK's AskUserQuestion as a Loop question card.
 *
 * Translates the SDK's `{ questions: [{ question, options, multiSelect, ... }] }`
 * input into Loop's native question shape, reuses `pendingQuestions()` and
 * the `question:request` bus event so `question-dialog.tsx` renders with
 * no additional wiring, waits for the user's answers (or session abort),
 * then returns `{ behavior: "allow", updatedInput: { questions, answers } }`
 * so the SDK echoes the answers back as the tool's result.
 */
async function askQuestionForSdk(
	sessionId: string,
	toolInput: Record<string, unknown>,
	signal: AbortSignal,
): Promise<PermissionResult> {
	const rawQuestions = Array.isArray(toolInput.questions) ? toolInput.questions : []
	const questions = rawQuestions.map((raw, idx) => {
		const q = (raw ?? {}) as Record<string, unknown>
		const options = Array.isArray(q.options)
			? q.options.map((raw) => {
					const opt = (raw ?? {}) as Record<string, unknown>
					return {
						label: typeof opt.label === "string" ? opt.label : "",
						...(typeof opt.description === "string" ? { description: opt.description } : {}),
					}
				})
			: undefined
		return {
			question: typeof q.question === "string" ? q.question : `Question ${idx + 1}`,
			...(options ? { options } : {}),
			multiple:
				typeof q.multiSelect === "boolean"
					? q.multiSelect
					: typeof q.multiple === "boolean"
						? q.multiple
						: false,
		}
	})

	if (questions.length === 0) {
		return {
			behavior: "allow",
			updatedInput: { ...toolInput, answers: [] },
		}
	}

	const questionId = ulid()
	const deferred = new Deferred<string[]>()
	pendingQuestions().set(questionId, deferred)

	setSessionStatus(sessionId, "awaiting-permission")

	bus().emit("question:request", {
		sessionId,
		question: {
			id: questionId,
			sessionId,
			tool: "question",
			questions,
		},
	})

	let abortHandler: (() => void) | undefined
	if (signal.aborted) {
		if (!deferred.settled) deferred.reject(new RejectedError())
	} else {
		abortHandler = () => {
			if (!deferred.settled) deferred.reject(new RejectedError())
		}
		signal.addEventListener("abort", abortHandler, { once: true })
	}

	try {
		const answers = await deferred.promise
		setSessionStatus(sessionId, "busy")
		return {
			behavior: "allow",
			updatedInput: {
				questions: toolInput.questions,
				answers,
			},
		}
	} catch (err) {
		return translatePermissionError(err, "AskUserQuestion")
	} finally {
		pendingQuestions().delete(questionId)
		if (abortHandler) signal.removeEventListener("abort", abortHandler)
	}
}

/** True if a Task/Agent tool input targets an explore-type subagent. */
function isExploreSubagent(input: Record<string, unknown>): boolean {
	const type = input.subagent_type
	return typeof type === "string" && type.toLowerCase() === "explore"
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
