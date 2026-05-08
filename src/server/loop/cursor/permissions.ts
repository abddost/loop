import type { PermissionRuleset } from "@core/schema/permission"
import { createLogger } from "../../logger"
import { ask, resolveRuleset } from "../../permission"
import { CorrectedError, DeniedError, RejectedError } from "../../permission/types"
import type {
	PermissionOption,
	RequestPermissionRequest,
	RequestPermissionResponse,
	ToolKind,
} from "./acp/types"

/**
 * Bridge ACP's `session/request_permission` callback into Loop's
 * `Permission.ask()` flow.
 *
 * Cursor (the agent) calls into us when it wants to run a sensitive tool.
 * We:
 *   1. Map ACP's `kind` (read/edit/execute/...) to Loop's permission
 *      category and patterns (file paths, commands).
 *   2. Call `Permission.ask()` which evaluates the active ruleset and, if
 *      the rule says "ask", emits a `permission:request` SSE event so the
 *      frontend prompts the user.
 *   3. Translate the user's reply (once/always/reject) back to one of
 *      ACP's offered `optionId`s.
 */

const log = createLogger("cursor-permissions")

export interface CursorPermissionContext {
	loopSessionId: string
	signal?: AbortSignal
	/** The agent's permission ruleset for this session/turn. */
	agentPermission: PermissionRuleset
	/** Session-level permission mode override ("default" | "full-access" | "custom"). */
	sessionPermissionMode?: string
	/** Session-level custom ruleset (used when mode is "custom"). */
	sessionRuleset?: PermissionRuleset
	/**
	 * Active agent name. Plan-mode agents (`plan`, `explore`) get a
	 * server-side guard that hard-rejects mutating tools regardless of
	 * the user's permission mode or the agent's prompt-following.
	 */
	agentName?: string
}

/**
 * Tool kinds that mutate filesystem state. When the plan agent is
 * active, these are auto-rejected unless the target is the plan file.
 */
const MUTATING_TOOL_KINDS: ReadonlySet<ToolKind> = new Set(["edit", "delete", "move"])

/**
 * Bash command prefixes that perform mutations. Used to gate `execute`
 * tool calls under the plan agent without having to enumerate every
 * read-only command.
 */
const MUTATING_BASH_PREFIXES: ReadonlySet<string> = new Set([
	"rm",
	"rmdir",
	"mv",
	"cp",
	"chmod",
	"chown",
	"mkdir",
	"touch",
	"sed",
	"tee",
	"dd",
	"ln",
	"npm",
	"bun",
	"pnpm",
	"yarn",
	"pip",
	"cargo",
	"go",
	"deno",
	"docker",
	"podman",
	"kubectl",
	"systemctl",
	"service",
	"launchctl",
	"make",
	"cmake",
])

/** Mutating git subcommands. `git status` / `git log` / `git diff` are fine. */
const MUTATING_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
	"add",
	"commit",
	"push",
	"checkout",
	"switch",
	"reset",
	"revert",
	"merge",
	"rebase",
	"cherry-pick",
	"stash",
	"branch",
	"tag",
	"remote",
	"pull",
	"fetch",
	"clean",
	"rm",
	"mv",
	"clone",
	"init",
	"submodule",
	"worktree",
])

function isPlanAgent(agentName: string | undefined): boolean {
	return agentName === "plan" || agentName === "explore"
}

/**
 * Plan mode is active when EITHER the active agent is a plan agent
 * OR the session permission mode is set to "plan" (UI toggle on the
 * input bar). Both must trigger the same hard-reject behavior — the
 * UI exposes a Plan toggle for cursor sessions, and choosing it must
 * apply real enforcement, not just a label change.
 */
function isPlanModeActive(
	agentName: string | undefined,
	sessionPermissionMode: string | undefined,
): boolean {
	return isPlanAgent(agentName) || sessionPermissionMode === "plan"
}

/**
 * Mirror of adapter.ts:isPlanFilePath — kept standalone here to avoid
 * the workspace-context dependency `planPath()` carries (so this module
 * is testable without a workspace runtime). The path shape is
 * `.loop/plans/<sessionId>.md` per src/server/plan/index.ts.
 */
function isPlanFilePath(path: string, loopSessionId: string | undefined): boolean {
	const target = path.replace(/\\/g, "/").replace(/^\.\//, "")
	if (loopSessionId) {
		const suffix = `.loop/plans/${loopSessionId}.md`
		if (target === suffix || target.endsWith(`/${suffix}`)) return true
	}
	return /(?:^|\/)\.loop\/plans\/[A-Za-z0-9_-]+\.md$/.test(target)
}

function planFileHint(loopSessionId: string | undefined): string {
	return loopSessionId ? `.loop/plans/${loopSessionId}.md` : ".loop/plans/<session>.md"
}

function extractTargetPath(rawInput: unknown): string | undefined {
	if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return undefined
	const obj = rawInput as Record<string, unknown>
	for (const key of [
		"path",
		"file_path",
		"filePath",
		"target",
		"absolute_path",
		"absolutePath",
		"uri",
	]) {
		const v = obj[key]
		if (typeof v === "string" && v.length > 0) return v
	}
	return undefined
}

/**
 * Decide whether a tool call must be hard-rejected because the plan
 * agent is active and the call would mutate state outside the plan file.
 *
 * Returns the human-readable reject reason, or undefined if the call
 * may proceed to normal permission gating.
 *
 * Exported (as the underscore-prefixed alias below) for unit testing
 * without spinning up a full permission ruleset.
 */
function reasonToHardReject(args: {
	agentName: string | undefined
	sessionPermissionMode?: string | undefined
	loopSessionId: string
	kind: ToolKind | undefined
	rawInput: unknown
	locations: ReadonlyArray<{ path: string }> | undefined
}): string | undefined {
	if (!isPlanModeActive(args.agentName, args.sessionPermissionMode)) return undefined

	const { kind, rawInput, locations, loopSessionId } = args

	if (kind && MUTATING_TOOL_KINDS.has(kind)) {
		// Allow only when the target is the plan file. Probe both the
		// rawInput common keys and the first ACP location.
		const targets: string[] = []
		const inputPath = extractTargetPath(rawInput)
		if (inputPath) targets.push(inputPath)
		if (locations) {
			for (const loc of locations) {
				if (typeof loc.path === "string" && loc.path.length > 0) targets.push(loc.path)
			}
		}
		if (targets.length === 0) {
			return `Plan mode: refusing ${kind} with no resolvable target path.`
		}
		const allTargetPlanFile = targets.every((p) => isPlanFilePath(p, loopSessionId))
		if (!allTargetPlanFile) {
			return `Plan mode forbids ${kind} on ${targets.join(", ")} — only ${planFileHint(loopSessionId)} may be modified.`
		}
		return undefined
	}

	if (kind === "execute") {
		const obj =
			rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
				? (rawInput as Record<string, unknown>)
				: {}
		const command =
			typeof obj.command === "string" ? obj.command : typeof obj.cmd === "string" ? obj.cmd : ""
		const trimmed = command.trim()
		if (!trimmed) return undefined
		const firstToken = (trimmed.split(/\s+/)[0] ?? "").toLowerCase()
		// Strip path prefix (/usr/bin/rm → rm, ./script.sh stays)
		const baseCommand = firstToken.includes("/")
			? (firstToken.split("/").pop() ?? firstToken)
			: firstToken
		if (MUTATING_BASH_PREFIXES.has(baseCommand)) {
			return `Plan mode forbids \`${trimmed.slice(0, 80)}\` — read-only commands only.`
		}
		if (baseCommand === "git") {
			const subcommand = (trimmed.split(/\s+/)[1] ?? "").toLowerCase()
			if (MUTATING_GIT_SUBCOMMANDS.has(subcommand)) {
				return `Plan mode forbids \`git ${subcommand}\` — only read-only git operations are allowed.`
			}
		}
		// Detect inline redirection / pipe-to-write patterns ( > / >> / | tee )
		if (/(^|[^>])>>?[^>]/.test(trimmed) || /\|\s*tee\b/.test(trimmed)) {
			return "Plan mode forbids file-writing redirection (`>`, `>>`, `| tee`)."
		}
	}

	return undefined
}

/** Map ACP semantic kind to a Loop permission category. */
function kindToPermission(kind: ToolKind | undefined): string {
	switch (kind) {
		case "read":
			return "read"
		case "edit":
			return "edit"
		case "delete":
		case "move":
			return "write"
		case "search":
			return "grep"
		case "execute":
			return "bash"
		case "fetch":
			return "fetch"
		default:
			return "tool"
	}
}

/**
 * Pull patterns (file paths, commands, etc.) out of the tool call snapshot.
 * Loop's permission engine matches each pattern against the active ruleset;
 * if any pattern is denied the call is rejected without prompting.
 */
function extractPatterns(
	kind: ToolKind | undefined,
	rawInput: unknown,
	locations: ReadonlyArray<{ path: string }> | undefined,
): { patterns: string[]; always: string[] } {
	const inputObj =
		rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
			? (rawInput as Record<string, unknown>)
			: {}

	if (kind === "execute") {
		const command =
			typeof inputObj.command === "string"
				? inputObj.command
				: typeof inputObj.cmd === "string"
					? inputObj.cmd
					: ""
		if (!command) return { patterns: ["*"], always: ["*"] }
		// Always-allow scope: just the first token (e.g. "git" rather than the
		// full command). Mirrors Loop's bash arity convention.
		const firstToken = command.split(/\s+/)[0] ?? command
		return { patterns: [command], always: [`${firstToken} *`] }
	}

	const paths: string[] = []
	if (locations) {
		for (const l of locations) {
			if (typeof l.path === "string" && l.path.length > 0) paths.push(l.path)
		}
	}
	for (const key of ["path", "file_path", "filePath", "target", "uri"]) {
		const v = inputObj[key]
		if (typeof v === "string" && v.length > 0) paths.push(v)
	}
	if (paths.length === 0) return { patterns: ["*"], always: ["*"] }
	return { patterns: paths, always: paths }
}

function pickOption(
	options: ReadonlyArray<PermissionOption>,
	kindPriority: ReadonlyArray<PermissionOption["kind"]>,
): PermissionOption | undefined {
	for (const target of kindPriority) {
		const found = options.find((o) => o.kind === target)
		if (found) return found
	}
	return undefined
}

/**
 * Build the ACP request_permission handler that delegates to Loop's
 * Permission module. Returns a function suitable to pass to
 * `client.onRequestPermission`.
 */
export function makeRequestPermissionHandler(ctx: CursorPermissionContext) {
	return async (req: RequestPermissionRequest): Promise<RequestPermissionResponse> => {
		const ruleset = resolveRuleset(
			ctx.agentPermission,
			ctx.sessionPermissionMode,
			ctx.sessionRuleset,
		)

		const tc = req.toolCall
		const kind = tc.kind ?? undefined
		const permission = kindToPermission(kind)
		const { patterns, always } = extractPatterns(kind, tc.rawInput, tc.locations ?? undefined)

		// PLAN-AGENT HARD GUARD — runs BEFORE Permission.ask() so the user
		// is never prompted for a tool that plan mode would never allow.
		// Independent of the user's permission mode (full-access can't
		// override plan mode for the plan agent).
		const rejectReason = reasonToHardReject({
			agentName: ctx.agentName,
			sessionPermissionMode: ctx.sessionPermissionMode,
			loopSessionId: ctx.loopSessionId,
			kind,
			rawInput: tc.rawInput,
			locations: tc.locations ?? undefined,
		})
		if (rejectReason) {
			log.info("Plan-mode hard-reject", {
				agent: ctx.agentName,
				kind,
				reason: rejectReason,
				toolCallId: tc.toolCallId,
			})
			const rejectOption = pickOption(req.options, ["reject_once", "reject_always"])
			if (rejectOption) {
				return { outcome: { outcome: "selected", optionId: rejectOption.optionId } }
			}
			return { outcome: { outcome: "cancelled" } }
		}

		try {
			await ask({
				id: tc.toolCallId,
				sessionId: ctx.loopSessionId,
				permission,
				patterns,
				always,
				ruleset,
				metadata: {
					tool: kind ?? "other",
					title: tc.title ?? undefined,
					input: tc.rawInput,
					locations: tc.locations ?? undefined,
				},
				...(ctx.signal ? { signal: ctx.signal } : {}),
			})

			// `ask` resolved → user approved. Choose the most specific option Cursor
			// offered: prefer "allow_once" because Loop already records the
			// always-rule in its own session-approved store; we don't need ACP to
			// remember it too.
			const allowOption = pickOption(req.options, ["allow_once", "allow_always"])
			if (allowOption) {
				return { outcome: { outcome: "selected", optionId: allowOption.optionId } }
			}
			// Cursor advertised neither — degrade to cancelled.
			log.warn("ACP permission options missing allow_*; cancelling", {
				offered: req.options.map((o) => o.kind),
			})
			return { outcome: { outcome: "cancelled" } }
		} catch (err) {
			if (
				err instanceof DeniedError ||
				err instanceof RejectedError ||
				err instanceof CorrectedError
			) {
				const rejectOption = pickOption(req.options, ["reject_once", "reject_always"])
				if (rejectOption) {
					return { outcome: { outcome: "selected", optionId: rejectOption.optionId } }
				}
				return { outcome: { outcome: "cancelled" } }
			}
			// Treat any other thrown value (incl. abort) as cancellation.
			log.info("Permission ask threw — cancelling", {
				error: err instanceof Error ? err.message : String(err),
			})
			return { outcome: { outcome: "cancelled" } }
		}
	}
}

/** Test-only export. */
export const _reasonToHardRejectForTesting = reasonToHardReject
