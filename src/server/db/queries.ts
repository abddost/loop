import type { InferSelectModel } from "drizzle-orm"
import { desc, eq, max } from "drizzle-orm"
import { get } from "./index"
import { configTable } from "./tables/config"
import { messageTable } from "./tables/message"
import { partTable } from "./tables/part"
import { projectTable } from "./tables/project"
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

/** Insert or update a project. Updates name, worktree, vcs, and updatedAt on conflict. */
export function upsertProject(data: {
	id: string
	name: string
	directory: string
	worktree?: string
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
			vcs: data.vcs ?? null,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: projectTable.directory,
			set: {
				name: data.name,
				worktree: data.worktree ?? null,
				vcs: data.vcs ?? null,
				updatedAt: now,
			},
		})
		.returning()
		.get()
}

// ─── Session Queries ─────────────────────────────────────────────

/** Find a session by its ID. */
export function findSessionById(id: string): Session | undefined {
	return get().select().from(sessionTable).where(eq(sessionTable.id, id)).get()
}

/** List sessions for a given directory, newest first. */
export function listSessionsByDirectory(directory: string): Session[] {
	return get()
		.select()
		.from(sessionTable)
		.where(eq(sessionTable.directory, directory))
		.orderBy(desc(sessionTable.createdAt))
		.all()
}

/** Create a new session. */
export function createSession(data: {
	id: string
	projectId: string
	directory: string
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
		compactedAt: number | null
		archivedAt: number | null
	}>,
): void {
	get()
		.update(sessionTable)
		.set({ ...data, updatedAt: Date.now() })
		.where(eq(sessionTable.id, id))
		.run()
}

/** Delete a session and all its messages/parts via cascade. */
export function deleteSession(id: string): void {
	// Delete parts and messages first (no cascade in SQLite FK by default for deletes within Drizzle)
	get().delete(partTable).where(eq(partTable.sessionId, id)).run()
	get().delete(messageTable).where(eq(messageTable.sessionId, id)).run()
	get().delete(sessionTable).where(eq(sessionTable.id, id)).run()
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
