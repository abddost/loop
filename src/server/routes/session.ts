import { AppError } from "@core/error"
import { ulid } from "@core/id"
import { Hono } from "hono"
import { globalBus } from "../bus/global"
import * as Database from "../db"
import {
	createMessage,
	createSession,
	deleteSession,
	findChildSessions,
	findMessagesBySessionId,
	findSessionById,
	listArchivedSessions,
	listSessionsByDirectory,
	updateSession,
	upsertPart,
} from "../db/queries"
import { createLogger } from "../logger"
import { getClaudeCodeCommands } from "../loop/claude-code/commands"
import { promptSession } from "../loop/prompt"
import { cleanupRevert, revertToMessage, unrevert } from "../loop/revert"
import { snapshot } from "../loop/snapshot"
import { cancelSession, listSessionStatuses, setSessionStatus } from "../loop/status"
import { type UsageRange, computeUsage } from "../loop/usage"
import { detectClaudeCode } from "../provider/claude-code/detect"
import { bus } from "../workspace/bus"
import { requireWorkspace } from "./require-workspace"

const log = createLogger("session")

export const sessionRoutes = new Hono()

/** GET /sessions - List sessions for current workspace directory, newest first. */
sessionRoutes.get("/sessions", (c) => {
	const { directory } = requireWorkspace()
	const sessions = listSessionsByDirectory(directory)
	return c.json(sessions)
})

/**
 * POST /sessions - Create a new session in current workspace.
 *
 * Accepts an optional client-supplied `id` (ULID) so the renderer can generate
 * the id locally, navigate to the session URL immediately, and POST it once the
 * user sends their first message. The insert is idempotent on `id`, which makes
 * the flow safe under refresh-during-creation and multi-tab races: the same
 * id POSTed twice returns the same row (HTTP 200 the second time).
 */
sessionRoutes.post("/sessions", async (c) => {
	const { directory, projectId } = requireWorkspace()
	const body = await c.req
		.json<{ id?: string; title?: string; permissionMode?: string }>()
		.catch(() => ({}))
	const parsed = body as { id?: string; title?: string; permissionMode?: string }

	let id: string
	if (typeof parsed.id === "string") {
		// Crockford-ULID, 26 chars, case-insensitive (matches @core/id format).
		if (!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(parsed.id)) {
			throw new AppError("Invalid session id (expected ULID)", {
				code: "BAD_REQUEST",
				statusCode: 400,
			})
		}
		id = parsed.id.toUpperCase()
	} else {
		id = ulid()
	}

	const existing = findSessionById(id)
	const session = createSession({
		id,
		projectId,
		directory,
		title: parsed.title,
		permissionMode: parsed.permissionMode,
	})
	// Status 200 when the row already existed (idempotent re-POST), 201 on fresh insert.
	return c.json(session, existing ? 200 : 201)
})

/** GET /sessions/status - Runtime status for all sessions in workspace (used by bootstrap). */
sessionRoutes.get("/sessions/status", (c) => {
	requireWorkspace()
	return c.json(listSessionStatuses())
})

/** GET /sessions/archived - List archived sessions with pagination. */
sessionRoutes.get("/sessions/archived", (c) => {
	const limit = Math.min(Number(c.req.query("limit")) || 20, 100)
	const offset = Math.max(Number(c.req.query("offset")) || 0, 0)
	return c.json(listArchivedSessions(limit, offset))
})

/** GET /sessions/:id - Get session with all messages and parts. */
sessionRoutes.get("/sessions/:id", (c) => {
	const id = c.req.param("id")
	const session = findSessionById(id)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}
	const messages = findMessagesBySessionId(id)
	return c.json({ ...session, messages })
})

/** PATCH /sessions/:id - Update session (title, archive). Emits SSE for multi-client sync. */
sessionRoutes.patch("/sessions/:id", async (c) => {
	const id = c.req.param("id")
	const session = findSessionById(id)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}

	const body = await c.req.json<{
		title?: string | null
		archivedAt?: number | null
	}>()
	updateSession(id, body)

	const updated = findSessionById(id)!
	globalBus.emit({
		type: "session:update",
		directory: updated.directory,
		sessionId: id,
		session: updated as any,
	})
	return c.json(updated)
})

/** DELETE /sessions/:id - Delete session and all messages/parts. */
sessionRoutes.delete("/sessions/:id", async (c) => {
	const id = c.req.param("id")
	const session = findSessionById(id)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}

	// Tear down any live Claude Code session runtime (persistent SDK query)
	// before removing the DB row — otherwise the background subprocess
	// outlives its session and keeps emitting events into the bus.
	const { closeSessionRuntime } = await import("../loop/claude-code/session-runtime")
	await closeSessionRuntime(id)
	const { clearSession } = await import("../loop/claude-code/pending-tasks")
	clearSession(id)

	deleteSession(id)
	return c.json({ ok: true })
})

/**
 * POST /sessions/:id/prompt - Submit a prompt to a session.
 * Delegates to promptSession which handles user message creation and the agentic loop.
 * Returns 202 Accepted immediately. Results are streamed via SSE.
 */
sessionRoutes.post("/sessions/:id/prompt", async (c) => {
	requireWorkspace()
	const sessionId = c.req.param("id")
	const session = findSessionById(sessionId)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}

	const body = await c.req.json<{
		messageId?: string
		text?: string
		files?: Array<{ path: string; mimeType: string; content: string }>
		model?: { modelId: string; providerId: string }
		agent?: string
		option?: string
		reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max" | "ultrathink"
		effort?: string
	}>()

	// Fire-and-forget: promptSession creates user message + runs the agentic loop.
	// Fan-out: if a loop is already running, the caller attaches as a callback.
	promptSession(sessionId, body).catch((err) =>
		log.error("Prompt failed", { sessionId, error: err }),
	)

	return c.json({ status: "accepted", sessionId }, 202)
})

/**
 * POST /sessions/:id/cancel - Cancel a running session.
 * Aborts the running agentic loop for this session.
 */
sessionRoutes.post("/sessions/:id/cancel", (c) => {
	const sessionId = c.req.param("id")
	const session = findSessionById(sessionId)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}

	cancelSession(sessionId)
	setSessionStatus(sessionId, "idle")

	return c.json({ status: "cancelled", sessionId })
})

/** GET /sessions/:id/children - List child sessions (subagent sessions) for a parent. */
sessionRoutes.get("/sessions/:id/children", (c) => {
	const id = c.req.param("id")
	const session = findSessionById(id)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}
	return c.json(findChildSessions(id))
})

/** GET /sessions/:id/messages - Get messages for any session (parent or child). */
sessionRoutes.get("/sessions/:id/messages", (c) => {
	const id = c.req.param("id")
	const session = findSessionById(id)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}
	return c.json(findMessagesBySessionId(id))
})

/**
 * GET /sessions/:id/diff - Full per-file unified diff for the session.
 *
 * Walks step-start/step-finish parts to find the earliest pre-edit snapshot
 * and the latest post-edit snapshot, then asks the shadow-git snapshot manager
 * for the structured diff between them. Returns `[]` when the session has no
 * captured snapshots (idle, non-git project, or edits haven't run yet).
 *
 * An optional `messageId` query param narrows the range to a single message.
 */
sessionRoutes.get("/sessions/:id/diff", async (c) => {
	requireWorkspace()
	const id = c.req.param("id")
	const session = findSessionById(id)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}
	const messageIdFilter = c.req.query("messageId") || undefined
	const messages = findMessagesBySessionId(id)

	let fromHash: string | undefined
	let toHash: string | undefined
	for (const msg of messages) {
		if (messageIdFilter && msg.id !== messageIdFilter) continue
		for (const part of msg.parts) {
			const data = part as Record<string, unknown>
			if (data.type === "step-start") {
				const hash = (data.snapshot as string | undefined) ?? undefined
				if (hash && !fromHash) fromHash = hash
			} else if (data.type === "step-finish") {
				const hash = (data.snapshot as string | undefined) ?? undefined
				if (hash) toHash = hash
			}
		}
	}

	if (!fromHash || !toHash || fromHash === toHash) {
		return c.json([])
	}

	const mgr = await snapshot()
	const diffs = await mgr.diffFull(fromHash, toHash)
	return c.json(diffs)
})

/**
 * GET /commands - Available Claude Code slash commands for the workspace.
 *
 * Workspace-scoped (cwd-keyed) instead of session-scoped: a single fetch
 * per workspace serves every input bar inside it. The `/` palette is
 * identical across sessions (same CLI binary, same project-level
 * `.claude/commands/*.md`), so per-session probes were wasted work.
 *
 * Soft-degrade contract: ALWAYS returns `{ commands }` (empty list
 * when the palette can't be resolved — CLI missing, probe failed, etc.)
 * so the frontend never has to deal with 4xx for an empty palette.
 */
sessionRoutes.get("/commands", async (c) => {
	const ws = requireWorkspace()
	const detection = await detectClaudeCode()
	if (!detection.installed || !detection.binaryPath) {
		return c.json({ commands: [] })
	}
	try {
		const commands = await getClaudeCodeCommands(detection.binaryPath, ws.directory)
		return c.json({ commands })
	} catch (err) {
		log.warn("Slash commands probe failed", {
			directory: ws.directory,
			error: err instanceof Error ? err.message : String(err),
		})
		return c.json({ commands: [] })
	}
})

/**
 * GET /usage?range=all|30d|7d - Aggregated lifetime usage stats.
 *
 * Global across every session in the DB (matching the Claude Code
 * CLI/desktop `/usage`, which is account-wide). Powers the `/usage`
 * card's range-tab refreshes. Returns the same shape as the persisted
 * `UsagePart`, so the frontend can display it transiently OR call the
 * sibling `POST /sessions/:id/usage` to materialise a snapshot into the
 * chat scrollback.
 */
sessionRoutes.get("/usage", (c) => {
	requireWorkspace()
	const rangeParam = c.req.query("range") ?? "all"
	const range: UsageRange =
		rangeParam === "30d" || rangeParam === "7d" ? rangeParam : "all"
	const usage = computeUsage(range)
	return c.json(usage)
})

/**
 * POST /sessions/:id/usage - Persist a `/usage` snapshot into a session.
 *
 * Inserts two messages into the session: a synthetic user "/usage"
 * marker and an assistant message carrying the `usage` part. Returns
 * the assistant message id so the client can scroll to it.
 *
 * Body: { range?: "all" | "30d" | "7d" } — defaults to "all".
 */
sessionRoutes.post("/sessions/:id/usage", async (c) => {
	const ws = requireWorkspace()
	const id = c.req.param("id")

	// `findSessionById` returns null when the route id refers to a
	// client-side draft (a ULID generated locally that hasn't seen a
	// first prompt yet — see `src/app/lib/draft-session.ts`). Drafts
	// are first-class sessions from the user's POV; they should be
	// able to run `/usage` immediately on a fresh new chat without
	// having to send a message first. `createSession` is idempotent
	// on id, so committing the draft here is safe under the rare
	// race where a concurrent first prompt already committed it.
	let session = findSessionById(id)
	if (!session) {
		session = createSession({
			id,
			projectId: ws.projectId,
			directory: ws.directory,
		})
	}

	const body = (await c.req.json().catch(() => ({}))) as { range?: string }
	const range: UsageRange =
		body.range === "30d" || body.range === "7d" ? body.range : "all"
	const usage = computeUsage(range)

	const now = Date.now()
	const userMessageId = ulid()
	const userPartId = ulid()
	const assistantMessageId = ulid()
	const assistantPartId = ulid()

	// `usageSnapshot: true` marks both messages so `computeUsage` can
	// skip them on a later `/usage` (otherwise the previous snapshot's
	// messages would pad the message count / heatmap). We deliberately
	// do NOT use `metadata.synthetic` or `text.synthetic` here — those
	// flags make `useActiveSession` (the hook that feeds MessageList)
	// filter the message out, which is what was hiding the card. The
	// `/usage` card is user-facing, not internal plumbing, so it must
	// render like a normal Q&A pair.
	const userMessage = {
		id: userMessageId,
		sessionId: id,
		role: "user" as const,
		metadata: { usageSnapshot: true },
		createdAt: now,
		updatedAt: now,
		parts: [{ id: userPartId, type: "text", text: "/usage" }],
	}
	const assistantMessage = {
		id: assistantMessageId,
		sessionId: id,
		role: "assistant" as const,
		metadata: { usageSnapshot: true },
		createdAt: now,
		updatedAt: now,
		parts: [{ id: assistantPartId, ...(usage as Record<string, unknown>) }],
	}

	Database.withEffects((_tx, effect) => {
		createMessage({ id: userMessageId, sessionId: id, role: "user", metadata: { usageSnapshot: true } })
		upsertPart({
			id: userPartId,
			sessionId: id,
			messageId: userMessageId,
			type: "text",
			data: { type: "text", text: "/usage" },
		})
		createMessage({
			id: assistantMessageId,
			sessionId: id,
			role: "assistant",
			metadata: { usageSnapshot: true },
		})
		upsertPart({
			id: assistantPartId,
			sessionId: id,
			messageId: assistantMessageId,
			type: "usage",
			data: usage,
		})
		effect(() => {
			bus().emit("message:create", { sessionId: id, message: userMessage })
			bus().emit("message:create", { sessionId: id, message: assistantMessage })
		})
	})

	return c.json({ messages: [userMessage, assistantMessage] })
})

/**
 * POST /sessions/:id/revert - Revert assistant file changes.
 * Body: { messageId: string, partId?: string }
 */
sessionRoutes.post("/sessions/:id/revert", async (c) => {
	requireWorkspace()
	const id = c.req.param("id")
	const session = findSessionById(id)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}

	const body = await c.req.json<{ messageId: string; partId?: string }>()
	const result = await revertToMessage(id, body.messageId, body.partId)
	if (!result.success) {
		throw new AppError(result.error ?? "Revert failed", { code: "BAD_REQUEST", statusCode: 400 })
	}
	return c.json(result)
})

/** POST /sessions/:id/unrevert - Undo a revert (restore pre-revert state). */
sessionRoutes.post("/sessions/:id/unrevert", async (c) => {
	requireWorkspace()
	const id = c.req.param("id")
	const session = findSessionById(id)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}

	const result = await unrevert(id)
	if (!result.success) {
		throw new AppError(result.error ?? "Unrevert failed", { code: "BAD_REQUEST", statusCode: 400 })
	}
	return c.json(result)
})

/** POST /sessions/:id/revert/cleanup - Remove messages after revert point. */
sessionRoutes.post("/sessions/:id/revert/cleanup", async (c) => {
	requireWorkspace()
	const id = c.req.param("id")
	const session = findSessionById(id)
	if (!session) {
		throw new AppError("Session not found", { code: "NOT_FOUND", statusCode: 404 })
	}

	const result = await cleanupRevert(id)
	if (!result.success) {
		throw new AppError(result.error ?? "Cleanup failed", { code: "BAD_REQUEST", statusCode: 400 })
	}
	return c.json(result)
})
