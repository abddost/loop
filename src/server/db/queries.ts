import type { InferSelectModel } from "drizzle-orm"
import { and, count, desc, eq, gt, gte, inArray, isNotNull, isNull, max } from "drizzle-orm"
import { get } from "./index"
import { configTable } from "./tables/config"
import { messageTable } from "./tables/message"
import { partTable } from "./tables/part"
import { projectTable } from "./tables/project"
import { sandboxTable } from "./tables/sandbox"
import { sessionTable } from "./tables/session"

// ─── Config Queries ─────────────────────────────────────────────

/** Get a single config value by key. Returns the raw JSON string or undefined. */
export function getConfigValue(key: string): string | undefined {
	const row = get().select().from(configTable).where(eq(configTable.key, key)).get()
	return row?.value
}

/** Set a config value. Upserts the key with a JSON-stringified value. */
export function setConfigValue(key: string, value: string): void {
	const now = Date.now()
	get()
		.insert(configTable)
		.values({ key, value, updatedAt: now })
		.onConflictDoUpdate({
			target: configTable.key,
			set: { value, updatedAt: now },
		})
		.run()
}

/** Read all config rows and return as a key→parsed-value record. */
export function getAllConfig(): Record<string, unknown> {
	const rows = get().select().from(configTable).all()
	const result: Record<string, unknown> = {}
	for (const row of rows) {
		try {
			result[row.key] = JSON.parse(row.value)
		} catch {
			// Skip malformed JSON values
		}
	}
	return result
}

/** Delete a config value by key. */
export function deleteConfigValue(key: string): void {
	get().delete(configTable).where(eq(configTable.key, key)).run()
}

// ─── Types ───────────────────────────────────────────────────────

export type Project = InferSelectModel<typeof projectTable>
export type Sandbox = InferSelectModel<typeof sandboxTable>
export type Session = InferSelectModel<typeof sessionTable>
export type Message = InferSelectModel<typeof messageTable>
export type Part = InferSelectModel<typeof partTable>
export type MessageWithParts = Message & { parts: Part[] }

// ─── Project Queries ─────────────────────────────────────────────

/** Find a project by its working directory. */
export function findProjectByDirectory(directory: string): Project | undefined {
	return get().select().from(projectTable).where(eq(projectTable.directory, directory)).get()
}

/** Find a project by its ID. */
export function findProjectById(id: string): Project | undefined {
	return get().select().from(projectTable).where(eq(projectTable.id, id)).get()
}

/** List all projects ordered by most recently updated. */
export function listProjects(): Project[] {
	return get().select().from(projectTable).orderBy(desc(projectTable.updatedAt)).all()
}

/** Insert or update a project. Updates name, worktree, vcs, gitCommonDir, and updatedAt on conflict. */
export function upsertProject(data: {
	id: string
	name: string
	directory: string
	worktree?: string
	gitCommonDir?: string
	vcs?: string
}): Project {
	const now = Date.now()
	return get()
		.insert(projectTable)
		.values({
			id: data.id,
			name: data.name,
			directory: data.directory,
			worktree: data.worktree ?? null,
			gitCommonDir: data.gitCommonDir ?? null,
			vcs: data.vcs ?? null,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: projectTable.directory,
			set: {
				name: data.name,
				worktree: data.worktree ?? null,
				gitCommonDir: data.gitCommonDir ?? null,
				vcs: data.vcs ?? null,
				updatedAt: now,
			},
		})
		.returning()
		.get()
}

/** Find a project by its shared git common dir (all worktrees of a repo share this). */
export function findProjectByGitCommonDir(gitCommonDir: string): Project | undefined {
	return get().select().from(projectTable).where(eq(projectTable.gitCommonDir, gitCommonDir)).get()
}

// ─── Session Queries ─────────────────────────────────────────────

/** Find a session by its ID. */
export function findSessionById(id: string): Session | undefined {
	return get().select().from(sessionTable).where(eq(sessionTable.id, id)).get()
}

/** List top-level sessions for a given directory, newest first. Excludes child and archived sessions. */
export function listSessionsByDirectory(directory: string): Session[] {
	return get()
		.select()
		.from(sessionTable)
		.where(
			and(
				eq(sessionTable.directory, directory),
				isNull(sessionTable.parentId),
				isNull(sessionTable.archivedAt),
			),
		)
		.orderBy(desc(sessionTable.createdAt))
		.all()
}

/** Create a new session. */
export function createSession(data: {
	id: string
	projectId: string
	directory: string
	parentId?: string
	title?: string
	permissionMode?: string
	permission?: unknown
}): Session {
	const now = Date.now()
	return get()
		.insert(sessionTable)
		.values({
			id: data.id,
			projectId: data.projectId,
			directory: data.directory,
			parentId: data.parentId ?? null,
			title: data.title ?? null,
			permissionMode: data.permissionMode ?? "default",
			permission: data.permission ?? null,
			createdAt: now,
			updatedAt: now,
		})
		.returning()
		.get()
}

/** Update session fields. Only provided fields are changed. */
export function updateSession(
	id: string,
	data: Partial<{
		title: string | null
		permissionMode: string
		permission: unknown
		revertState: unknown
		compactedAt: number | null
		archivedAt: number | null
		claudeCodeSessionId: string | null
		claudeCodeCwd: string | null
		claudeCodeLastTurnId: string | null
	}>,
): void {
	get()
		.update(sessionTable)
		.set({ ...data, updatedAt: Date.now() })
		.where(eq(sessionTable.id, id))
		.run()
}

/**
 * Delete all messages (and their parts) in a session that come after
 * the given ordinal. Used by the revert system.
 */
export function deleteMessagesAfter(sessionId: string, afterOrdinal: number): void {
	const toDelete = get()
		.select({ id: messageTable.id })
		.from(messageTable)
		.where(and(eq(messageTable.sessionId, sessionId), gt(messageTable.ordinal, afterOrdinal)))
		.all()

	for (const msg of toDelete) {
		get().delete(partTable).where(eq(partTable.messageId, msg.id)).run()
		get().delete(messageTable).where(eq(messageTable.id, msg.id)).run()
	}
}

/**
 * Delete parts in a message that have ordinal >= the given ordinal.
 * Used by partial revert (revert to a specific part within a message).
 */
export function deletePartsFrom(messageId: string, fromOrdinal: number): string[] {
	const toDelete = get()
		.select({ id: partTable.id })
		.from(partTable)
		.where(and(eq(partTable.messageId, messageId), gte(partTable.ordinal, fromOrdinal)))
		.all()

	const deletedIds = toDelete.map((p) => p.id)
	for (const part of toDelete) {
		get().delete(partTable).where(eq(partTable.id, part.id)).run()
	}
	return deletedIds
}

/** Find all child sessions for a parent session. */
export function findChildSessions(parentSessionId: string): Session[] {
	return get()
		.select()
		.from(sessionTable)
		.where(eq(sessionTable.parentId, parentSessionId))
		.orderBy(sessionTable.createdAt)
		.all()
}

/** Delete a session and all its messages/parts via cascade. Also deletes child sessions. */
export function deleteSession(id: string): void {
	// Delete child sessions first (recursive cascade)
	const children = findChildSessions(id)
	for (const child of children) {
		deleteSession(child.id)
	}

	// Delete parts and messages (no cascade in SQLite FK by default for deletes within Drizzle)
	get().delete(partTable).where(eq(partTable.sessionId, id)).run()
	get().delete(messageTable).where(eq(messageTable.sessionId, id)).run()
	get().delete(sessionTable).where(eq(sessionTable.id, id)).run()
}

/** List all sessions belonging to a project (including child sessions). */
export function listSessionsByProjectId(projectId: string): Session[] {
	return get().select().from(sessionTable).where(eq(sessionTable.projectId, projectId)).all()
}

/**
 * Delete a project and all its sessions/messages/parts.
 * Deletes in FK-safe order: parts → messages → sessions → project.
 */
export function deleteProjectCascade(projectId: string): void {
	const sessions = listSessionsByProjectId(projectId)
	for (const session of sessions) {
		get().delete(partTable).where(eq(partTable.sessionId, session.id)).run()
		get().delete(messageTable).where(eq(messageTable.sessionId, session.id)).run()
	}
	get().delete(sessionTable).where(eq(sessionTable.projectId, projectId)).run()
	get().delete(projectTable).where(eq(projectTable.id, projectId)).run()
}

/** List archived sessions across all projects, newest archived first. Paginated. */
export function listArchivedSessions(
	limit: number,
	offset: number,
): { items: (Session & { projectName: string })[]; total: number } {
	const totalRow = get()
		.select({ count: count() })
		.from(sessionTable)
		.where(isNotNull(sessionTable.archivedAt))
		.get()
	const total = totalRow?.count ?? 0

	const rows = get()
		.select({
			session: sessionTable,
			projectName: projectTable.name,
		})
		.from(sessionTable)
		.innerJoin(projectTable, eq(sessionTable.projectId, projectTable.id))
		.where(isNotNull(sessionTable.archivedAt))
		.orderBy(desc(sessionTable.archivedAt))
		.limit(limit)
		.offset(offset)
		.all()
	return { items: rows.map((r) => ({ ...r.session, projectName: r.projectName })), total }
}

// ─── Message Queries ─────────────────────────────────────────────

/** Get all messages for a session with their parts, ordered by ordinal. */
export function findMessagesBySessionId(sessionId: string): MessageWithParts[] {
	const messages = get()
		.select()
		.from(messageTable)
		.where(eq(messageTable.sessionId, sessionId))
		.orderBy(messageTable.ordinal)
		.all()

	if (messages.length === 0) return []

	const parts = get()
		.select()
		.from(partTable)
		.where(eq(partTable.sessionId, sessionId))
		.orderBy(partTable.ordinal)
		.all()

	const partsByMessage = new Map<string, Part[]>()
	for (const row of parts) {
		let list = partsByMessage.get(row.messageId)
		if (!list) {
			list = []
			partsByMessage.set(row.messageId, list)
		}
		// The `data` column (mode: "json") holds the Part payload.
		// Merge the row id so consumers get Part objects with stable IDs
		// (matching what SSE part:upsert events include).
		list.push({ id: row.id, ...(row.data as Record<string, unknown>) } as Part)
	}

	return messages.map((msg) => ({
		...msg,
		parts: partsByMessage.get(msg.id) ?? [],
	}))
}

/** Get the next ordinal for a new message in a session. */
export function getNextOrdinal(sessionId: string): number {
	const result = get()
		.select({ maxOrdinal: max(messageTable.ordinal) })
		.from(messageTable)
		.where(eq(messageTable.sessionId, sessionId))
		.get()
	return (result?.maxOrdinal ?? -1) + 1
}

/** Create a new message. */
export function createMessage(data: {
	id: string
	sessionId: string
	role: string
	metadata?: unknown
}): Message {
	const now = Date.now()
	const ordinal = getNextOrdinal(data.sessionId)
	return get()
		.insert(messageTable)
		.values({
			id: data.id,
			sessionId: data.sessionId,
			role: data.role,
			metadata: data.metadata ?? null,
			ordinal,
			createdAt: now,
			updatedAt: now,
		})
		.returning()
		.get()
}

/** Update message fields. Merges metadata with existing values instead of overwriting. */
export function updateMessage(id: string, data: Partial<{ metadata: unknown }>): void {
	if (data.metadata != null) {
		const existing = get()
			.select({ metadata: messageTable.metadata })
			.from(messageTable)
			.where(eq(messageTable.id, id))
			.get()
		const merged = {
			...((existing?.metadata as Record<string, unknown>) ?? {}),
			...(data.metadata as Record<string, unknown>),
		}
		get()
			.update(messageTable)
			.set({ metadata: merged, updatedAt: Date.now() })
			.where(eq(messageTable.id, id))
			.run()
	} else {
		get()
			.update(messageTable)
			.set({ ...data, updatedAt: Date.now() })
			.where(eq(messageTable.id, id))
			.run()
	}
}

// ─── Part Queries ────────────────────────────────────────────────

/** Get all parts for a message, ordered by ordinal. */
export function findPartsByMessageId(messageId: string): Part[] {
	const rows = get()
		.select()
		.from(partTable)
		.where(eq(partTable.messageId, messageId))
		.orderBy(partTable.ordinal)
		.all()
	return rows.map((r) => ({ id: r.id, ...(r.data as Record<string, unknown>) }) as Part)
}

/** Get the next ordinal for a new part in a message. */
export function getNextPartOrdinal(messageId: string): number {
	const result = get()
		.select({ maxOrdinal: max(partTable.ordinal) })
		.from(partTable)
		.where(eq(partTable.messageId, messageId))
		.get()
	return (result?.maxOrdinal ?? -1) + 1
}

/** Insert or update a part. Updates type, data, and updatedAt on conflict. */
export function upsertPart(data: {
	id: string
	sessionId: string
	messageId: string
	type: string
	data: unknown
}): void {
	const now = Date.now()
	const ordinal = getNextPartOrdinal(data.messageId)
	get()
		.insert(partTable)
		.values({
			id: data.id,
			sessionId: data.sessionId,
			messageId: data.messageId,
			type: data.type,
			ordinal,
			data: data.data,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: partTable.id,
			set: {
				type: data.type,
				data: data.data,
				updatedAt: now,
			},
		})
		.run()
}

// ─── Sandbox Queries ────────────────────────────────────────────

/** Create a new sandbox record. */
export function createSandbox(data: {
	id: string
	projectId: string
	name: string
	directory: string
	branch: string
	status?: string
}): Sandbox {
	const now = Date.now()
	return get()
		.insert(sandboxTable)
		.values({
			id: data.id,
			projectId: data.projectId,
			name: data.name,
			directory: data.directory,
			branch: data.branch,
			status: data.status ?? "creating",
			createdAt: now,
			updatedAt: now,
		})
		.returning()
		.get()
}

/** Find all sandboxes for a project. */
export function findSandboxesByProjectId(projectId: string): Sandbox[] {
	return get()
		.select()
		.from(sandboxTable)
		.where(eq(sandboxTable.projectId, projectId))
		.orderBy(desc(sandboxTable.createdAt))
		.all()
}

/** Find a sandbox by its directory path. */
export function findSandboxByDirectory(directory: string): Sandbox | undefined {
	return get().select().from(sandboxTable).where(eq(sandboxTable.directory, directory)).get()
}

/** Find a sandbox by its ID. */
export function findSandboxById(id: string): Sandbox | undefined {
	return get().select().from(sandboxTable).where(eq(sandboxTable.id, id)).get()
}

/** Update a sandbox's status and updatedAt. */
export function updateSandbox(
	id: string,
	data: Partial<{ status: string; name: string; branch: string }>,
): void {
	get()
		.update(sandboxTable)
		.set({ ...data, updatedAt: Date.now() })
		.where(eq(sandboxTable.id, id))
		.run()
}

/** Delete a sandbox by its ID. */
export function deleteSandbox(id: string): void {
	get().delete(sandboxTable).where(eq(sandboxTable.id, id)).run()
}

/** List ALL sandboxes across all projects, joined with project info. Ordered by newest first. */
export function findAllSandboxesWithProject(): (Sandbox & {
	projectName: string
	projectDirectory: string
})[] {
	return get()
		.select({
			id: sandboxTable.id,
			projectId: sandboxTable.projectId,
			name: sandboxTable.name,
			directory: sandboxTable.directory,
			branch: sandboxTable.branch,
			status: sandboxTable.status,
			createdAt: sandboxTable.createdAt,
			updatedAt: sandboxTable.updatedAt,
			projectName: projectTable.name,
			projectDirectory: projectTable.directory,
		})
		.from(sandboxTable)
		.innerJoin(projectTable, eq(sandboxTable.projectId, projectTable.id))
		.orderBy(desc(sandboxTable.createdAt))
		.all()
}

/** List ALL sandboxes across all projects, ordered by newest first. */
export function findAllSandboxes(): Sandbox[] {
	return get().select().from(sandboxTable).orderBy(desc(sandboxTable.createdAt)).all()
}

/**
 * Find top-level, non-archived session titles for a set of worktree directories.
 * Returns { directory, id, title }[] ordered by creation date (newest first).
 */
export function findSessionTitlesByDirectories(
	directories: string[],
): { directory: string; id: string; title: string | null }[] {
	if (directories.length === 0) return []
	return get()
		.select({
			directory: sessionTable.directory,
			id: sessionTable.id,
			title: sessionTable.title,
		})
		.from(sessionTable)
		.where(
			and(
				inArray(sessionTable.directory, directories),
				isNull(sessionTable.parentId),
				isNull(sessionTable.archivedAt),
			),
		)
		.orderBy(desc(sessionTable.createdAt))
		.all()
}
