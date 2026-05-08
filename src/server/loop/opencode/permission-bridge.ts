import type { PermissionRuleset } from "@core/schema/permission"
import { AgentRegistry } from "../../agent"
import * as queries from "../../db/queries"
import { createLogger } from "../../logger"
import { ask, permissionState, resolveRuleset } from "../../permission"
import { CorrectedError, DeniedError, RejectedError } from "../../permission/types"
import { bus } from "../../workspace/bus"
import type { OpenCodePermissionRequest } from "./adapter"

/**
 * Bridge between OpenCode's permission system and Loop's permission UI.
 *
 * OpenCode owns its own tools (the CLI executes them) and decides when to
 * ask for permission. When it does, it emits a `permission.asked` event
 * with its own request id. We forward that into Loop's canonical
 * `Permission.ask()` flow — the same path Cursor uses — so the request
 * is evaluated against the active ruleset (rule may auto-allow or
 * auto-deny without prompting), surfaced via the existing UI when the
 * user must decide, and cached as a session-level "always" rule when
 * appropriate.
 *
 * On user approval we forward back to OpenCode with `"once"` or
 * `"always"` based on whether Loop's `state.sessionApproved` grew during
 * the wait. On rejection we send `"reject"`.
 *
 * This replaces the previous "synthetic registration" pattern that
 * always reported `"once"` to OpenCode regardless of what the user
 * picked, leaking re-approval prompts on every subsequent tool call.
 */

const log = createLogger("opencode-permission-bridge")

/** Tracks which OpenCode requests are currently in-flight per Loop session. */
const pendingByLoopSession = new Map<string, Set<string>>()

/** AbortControllers for the in-flight `ask()` calls so we can cancel on
 *  turn end. */
const pendingAborts = new Map<string, AbortController>()

interface RegisterInput {
	sessionId: string
	request: OpenCodePermissionRequest
	reply: (decision: "once" | "always" | "reject") => Promise<void>
}

/**
 * Register an OpenCode permission request with Loop's permission state and
 * forward the user's decision back to OpenCode. Idempotent on
 * `request.id` — re-registering the same id is a no-op.
 *
 * The `ask()` flow may resolve immediately when the ruleset auto-allows
 * the patterns; we still forward a `"once"` reply so OpenCode can
 * proceed, and the user never sees a prompt.
 */
export function registerOpenCodePermission(input: RegisterInput): void {
	const state = permissionState()
	if (state.pending.has(input.request.id)) return

	let track = pendingByLoopSession.get(input.sessionId)
	if (!track) {
		track = new Set()
		pendingByLoopSession.set(input.sessionId, track)
	}
	track.add(input.request.id)

	const abort = new AbortController()
	pendingAborts.set(input.request.id, abort)

	void runAsk(input, abort).finally(() => {
		track?.delete(input.request.id)
		pendingAborts.delete(input.request.id)
	})
}

async function runAsk(input: RegisterInput, abort: AbortController): Promise<void> {
	const { sessionId, request } = input
	const ruleset = resolveSessionRuleset(sessionId)
	const permission = mapPermission(request.permission)
	const patterns = (request.patterns ?? []).filter((p) => typeof p === "string" && p.length > 0)
	const always = (request.always ?? []).filter((p) => typeof p === "string" && p.length > 0)
	const effectivePatterns = patterns.length > 0 ? patterns : ["*"]
	const effectiveAlways = always.length > 0 ? always : effectivePatterns

	// Snapshot session-approved rules BEFORE asking so we can detect a
	// post-approval `"always"` choice — `reply()` adds rules to
	// `state.sessionApproved` only on the always branch.
	const beforeCount = countSessionApproved(sessionId, permission)

	try {
		await ask({
			id: request.id,
			sessionId,
			permission,
			patterns: effectivePatterns,
			always: effectiveAlways,
			ruleset,
			metadata: {
				...(request.metadata ?? {}),
				tool: request.permission,
				patterns: effectivePatterns,
			},
			signal: abort.signal,
		})

		const afterCount = countSessionApproved(sessionId, permission)
		const decision: "once" | "always" = afterCount > beforeCount ? "always" : "once"
		await input
			.reply(decision)
			.catch((err) => logBridgeError("approve", sessionId, request.id, err))
	} catch (err) {
		if (
			err instanceof DeniedError ||
			err instanceof RejectedError ||
			err instanceof CorrectedError
		) {
			await input.reply("reject").catch((e) => logBridgeError("reject", sessionId, request.id, e))
			return
		}
		// Aborts and unexpected errors: also reject so OpenCode unblocks.
		await input.reply("reject").catch((e) => logBridgeError("reject", sessionId, request.id, e))
	}
}

/**
 * Resolve every pending OpenCode permission for a session. Cancels the
 * underlying `ask()` (which throws via the abort signal and triggers a
 * `"reject"` reply to OpenCode). Used on turn cleanup / abort so OpenCode
 * isn't left waiting on a reply that will never come.
 */
export function resolveOpenCodePermission(
	sessionId: string,
	_decision: "once" | "always" | "reject",
): void {
	const track = pendingByLoopSession.get(sessionId)
	if (!track || track.size === 0) return
	for (const requestId of [...track]) {
		const abort = pendingAborts.get(requestId)
		abort?.abort()
		// Also clean up Loop's pending entry directly, in case the ask()
		// hasn't yet observed the abort. Mirrors `permission.ts` which
		// removes on `reply()`.
		try {
			permissionState().pending.delete(requestId)
		} catch {
			/* swallow */
		}
	}
	pendingByLoopSession.delete(sessionId)
}

// Optional bus signal used solely to update session status when a
// permission is in flight and there's nothing else to do — keeps parity
// with the previous bridge implementation.
export function emitPermissionRequestEvent(
	sessionId: string,
	request: OpenCodePermissionRequest,
): void {
	bus().emit("permission:request", {
		sessionId,
		request: {
			id: request.id,
			sessionId,
			tool: request.permission,
			input: request.metadata,
			reason: (request.metadata as { reason?: string })?.reason,
			type: request.permission === "doom_loop" ? "doom_loop" : "tool",
			patterns: request.patterns,
		},
	})
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function resolveSessionRuleset(sessionId: string): PermissionRuleset {
	const session = queries.findSessionById(sessionId)
	if (!session) return []
	const messages = queries.findMessagesBySessionId(sessionId)
	let agentName: string | undefined
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role !== "user") continue
		const meta = messages[i].metadata as { agent?: string } | undefined
		if (meta?.agent) {
			agentName = meta.agent
			break
		}
		break
	}
	const agent = AgentRegistry.get(agentName ?? "build")
	const sessionRuleset = Array.isArray(session.permission)
		? (session.permission as PermissionRuleset)
		: undefined
	return resolveRuleset(
		agent?.permission ?? [],
		(session.permissionMode as string | undefined) ?? "default",
		sessionRuleset,
	)
}

/**
 * Translate OpenCode's permission category to Loop's permission name.
 * OpenCode emits names like "edit", "bash", "read", "webfetch" — most
 * already match Loop. The mapping handles the few that diverge.
 */
function mapPermission(raw: string): string {
	switch (raw.toLowerCase()) {
		case "edit":
		case "patch":
		case "apply-patch":
		case "apply_patch":
		case "multiedit":
		case "write":
			return raw.toLowerCase().replace(/_/g, "-") === "apply-patch"
				? "apply-patch"
				: raw.toLowerCase()
		case "command":
		case "shell":
		case "bash":
			return "bash"
		case "webfetch":
		case "web-fetch":
		case "web_fetch":
			return "fetch"
		case "websearch":
		case "web-search":
		case "web_search":
			return "fetch"
		case "doom_loop":
			return "doom_loop"
		default:
			return raw.toLowerCase()
	}
}

function countSessionApproved(sessionId: string, permission: string): number {
	const approved = permissionState().sessionApproved.get(sessionId)
	if (!approved) return 0
	return approved.filter((r) => r.permission === permission || r.permission === "*").length
}

function logBridgeError(action: string, sessionId: string, requestId: string, err: unknown): void {
	log.warn(`OpenCode permission ${action} forwarding failed`, {
		sessionId,
		requestId,
		error: err instanceof Error ? err.message : String(err),
	})
}
