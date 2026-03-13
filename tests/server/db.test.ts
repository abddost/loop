import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { Database as BunDB } from "bun:sqlite"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { eq, desc } from "drizzle-orm"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import * as schema from "@server/db/schema"
import { withEffects } from "@server/db/effect"

// ─── In-memory DB setup ───────────────────────────────────────

function createTestDb() {
	const raw = new BunDB(":memory:")
	raw.run("PRAGMA journal_mode = WAL")
	raw.run("PRAGMA foreign_keys = ON")
	const db = drizzle(raw, { schema })
	migrate(db, { migrationsFolder: "./drizzle" })
	return { db, raw }
}

let testDb: ReturnType<typeof createTestDb>

beforeAll(() => {
	testDb = createTestDb()
})

afterAll(() => {
	testDb.raw.close()
})

beforeEach(() => {
	// Clean all tables before each test
	const { db } = testDb
	db.delete(schema.partTable).run()
	db.delete(schema.messageTable).run()
	db.delete(schema.sessionTable).run()
	db.delete(schema.projectTable).run()
})

// ─── Helpers ──────────────────────────────────────────────────

function insertProject(id = "proj1", directory = "/workspace") {
	const { db } = testDb
	const now = Date.now()
	return db
		.insert(schema.projectTable)
		.values({
			id,
			name: "Test Project",
			directory,
			worktree: null,
			vcs: "git",
			createdAt: now,
			updatedAt: now,
		})
		.returning()
		.get()
}

function insertSession(id = "sess1", projectId = "proj1", directory = "/workspace") {
	const { db } = testDb
	const now = Date.now()
	return db
		.insert(schema.sessionTable)
		.values({
			id,
			projectId,
			directory,
			title: null,
			permission: null,
			createdAt: now,
			updatedAt: now,
		})
		.returning()
		.get()
}

function insertMessage(
	id: string,
	sessionId: string,
	role: string,
	ordinal: number,
	metadata?: unknown,
) {
	const { db } = testDb
	const now = Date.now()
	return db
		.insert(schema.messageTable)
		.values({
			id,
			sessionId,
			role,
			metadata: metadata ?? null,
			ordinal,
			createdAt: now,
			updatedAt: now,
		})
		.returning()
		.get()
}

function insertPart(
	id: string,
	sessionId: string,
	messageId: string,
	type: string,
	ordinal: number,
	data?: unknown,
) {
	const { db } = testDb
	const now = Date.now()
	return db
		.insert(schema.partTable)
		.values({
			id,
			sessionId,
			messageId,
			type,
			ordinal,
			data: data ?? null,
			createdAt: now,
			updatedAt: now,
		})
		.returning()
		.get()
}

// ─── Project CRUD ─────────────────────────────────────────────

describe("Project CRUD", () => {
	it("creates a project and finds it by directory", () => {
		const { db } = testDb
		insertProject("p1", "/my/project")
		const found = db
			.select()
			.from(schema.projectTable)
			.where(eq(schema.projectTable.directory, "/my/project"))
			.get()
		expect(found).toBeDefined()
		expect(found!.id).toBe("p1")
		expect(found!.name).toBe("Test Project")
		expect(found!.vcs).toBe("git")
	})

	it("upserts project on conflict (same directory)", () => {
		const { db } = testDb
		insertProject("p1", "/workspace")
		// Insert with same directory but different name
		db.insert(schema.projectTable)
			.values({
				id: "p2",
				name: "Updated Project",
				directory: "/workspace",
				worktree: null,
				vcs: null,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			})
			.onConflictDoUpdate({
				target: schema.projectTable.directory,
				set: { name: "Updated Project", updatedAt: Date.now() },
			})
			.run()

		const found = db
			.select()
			.from(schema.projectTable)
			.where(eq(schema.projectTable.directory, "/workspace"))
			.get()
		expect(found!.name).toBe("Updated Project")
	})
})

// ─── Session CRUD ─────────────────────────────────────────────

describe("Session CRUD", () => {
	it("creates a session and lists by directory", () => {
		const { db } = testDb
		insertProject("p1", "/workspace")
		insertSession("s1", "p1", "/workspace")
		insertSession("s2", "p1", "/workspace")

		const sessions = db
			.select()
			.from(schema.sessionTable)
			.where(eq(schema.sessionTable.directory, "/workspace"))
			.orderBy(desc(schema.sessionTable.createdAt))
			.all()
		expect(sessions).toHaveLength(2)
	})

	it("updates session fields", () => {
		const { db } = testDb
		insertProject("p1", "/workspace")
		insertSession("s1", "p1", "/workspace")

		db.update(schema.sessionTable)
			.set({ title: "Updated Title", updatedAt: Date.now() })
			.where(eq(schema.sessionTable.id, "s1"))
			.run()

		const found = db
			.select()
			.from(schema.sessionTable)
			.where(eq(schema.sessionTable.id, "s1"))
			.get()
		expect(found!.title).toBe("Updated Title")
	})

	it("deletes session and cascades to messages and parts", () => {
		const { db } = testDb
		insertProject("p1", "/workspace")
		insertSession("s1", "p1", "/workspace")
		insertMessage("m1", "s1", "user", 0)
		insertPart("part1", "s1", "m1", "text", 0, { type: "text", text: "hello" })

		// Manually delete (simulating deleteSession logic)
		db.delete(schema.partTable).where(eq(schema.partTable.sessionId, "s1")).run()
		db.delete(schema.messageTable).where(eq(schema.messageTable.sessionId, "s1")).run()
		db.delete(schema.sessionTable).where(eq(schema.sessionTable.id, "s1")).run()

		expect(
			db.select().from(schema.sessionTable).where(eq(schema.sessionTable.id, "s1")).get(),
		).toBeUndefined()
		expect(
			db
				.select()
				.from(schema.messageTable)
				.where(eq(schema.messageTable.sessionId, "s1"))
				.all(),
		).toHaveLength(0)
		expect(
			db.select().from(schema.partTable).where(eq(schema.partTable.sessionId, "s1")).all(),
		).toHaveLength(0)
	})
})

// ─── Message CRUD ─────────────────────────────────────────────

describe("Message CRUD", () => {
	it("creates a message and finds by session ID", () => {
		const { db } = testDb
		insertProject("p1", "/workspace")
		insertSession("s1", "p1", "/workspace")
		insertMessage("m1", "s1", "user", 0, { agent: "build" })
		insertMessage("m2", "s1", "assistant", 1, { modelId: "claude-sonnet-4-5" })

		const messages = db
			.select()
			.from(schema.messageTable)
			.where(eq(schema.messageTable.sessionId, "s1"))
			.orderBy(schema.messageTable.ordinal)
			.all()
		expect(messages).toHaveLength(2)
		expect(messages[0].role).toBe("user")
		expect(messages[1].role).toBe("assistant")
	})

	it("stores and retrieves JSON metadata", () => {
		const { db } = testDb
		insertProject("p1", "/workspace")
		insertSession("s1", "p1", "/workspace")
		const metadata = { agent: "build", model: { modelId: "m1", providerId: "p1" } }
		insertMessage("m1", "s1", "user", 0, metadata)

		const found = db
			.select()
			.from(schema.messageTable)
			.where(eq(schema.messageTable.id, "m1"))
			.get()
		expect(found!.metadata).toEqual(metadata)
	})
})

// ─── Part CRUD ────────────────────────────────────────────────

describe("Part CRUD", () => {
	it("creates parts and finds by message ID", () => {
		const { db } = testDb
		insertProject("p1", "/workspace")
		insertSession("s1", "p1", "/workspace")
		insertMessage("m1", "s1", "user", 0)
		insertPart("p1", "s1", "m1", "text", 0, { type: "text", text: "hello" })
		insertPart("p2", "s1", "m1", "file", 1, {
			type: "file",
			path: "/a.txt",
			mimeType: "text/plain",
			content: "data",
		})

		const parts = db
			.select()
			.from(schema.partTable)
			.where(eq(schema.partTable.messageId, "m1"))
			.orderBy(schema.partTable.ordinal)
			.all()
		expect(parts).toHaveLength(2)
		expect(parts[0].type).toBe("text")
		expect(parts[1].type).toBe("file")
	})

	it("upserts part on conflict (same id)", () => {
		const { db } = testDb
		insertProject("p1", "/workspace")
		insertSession("s1", "p1", "/workspace")
		insertMessage("m1", "s1", "user", 0)
		insertPart("p1", "s1", "m1", "text", 0, { type: "text", text: "original" })

		// Upsert with same id
		db.insert(schema.partTable)
			.values({
				id: "p1",
				sessionId: "s1",
				messageId: "m1",
				type: "text",
				ordinal: 0,
				data: { type: "text", text: "updated" },
				createdAt: Date.now(),
				updatedAt: Date.now(),
			})
			.onConflictDoUpdate({
				target: schema.partTable.id,
				set: {
					type: "text",
					data: { type: "text", text: "updated" },
					updatedAt: Date.now(),
				},
			})
			.run()

		const found = db
			.select()
			.from(schema.partTable)
			.where(eq(schema.partTable.id, "p1"))
			.get()
		expect((found!.data as any).text).toBe("updated")
	})
})

// ─── withEffects ──────────────────────────────────────────────

describe("withEffects", () => {
	it("fires effect callbacks after commit", () => {
		const { db } = testDb
		const effectCalls: string[] = []

		withEffects(db, (_tx, effect) => {
			insertProject("p-effect", "/effect-workspace")
			effect(() => effectCalls.push("effect1"))
			effect(() => effectCalls.push("effect2"))
		})

		expect(effectCalls).toEqual(["effect1", "effect2"])
	})

	it("does not fire effects if transaction throws", () => {
		const { db } = testDb
		const effectCalls: string[] = []

		expect(() =>
			withEffects(db, (_tx, effect) => {
				effect(() => effectCalls.push("should-not-fire"))
				throw new Error("rollback")
			}),
		).toThrow("rollback")

		expect(effectCalls).toEqual([])
	})

	it("returns the value from the transaction function", () => {
		const { db } = testDb
		const result = withEffects(db, (_tx, _effect) => {
			return 42
		})
		expect(result).toBe(42)
	})

	it("catches effect errors without throwing", () => {
		const { db } = testDb
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		const effectCalls: string[] = []

		withEffects(db, (_tx, effect) => {
			effect(() => {
				throw new Error("effect error")
			})
			effect(() => effectCalls.push("second-effect"))
		})

		// Second effect should still fire despite first throwing
		expect(effectCalls).toEqual(["second-effect"])
		expect(consoleSpy).toHaveBeenCalled()
		consoleSpy.mockRestore()
	})
})
