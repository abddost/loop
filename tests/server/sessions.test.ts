import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import * as db from "../../src/server/db"
import { createSession, findSessionById, upsertProject } from "../../src/server/db/queries"
import { messageTable } from "../../src/server/db/tables/message"
import { partTable } from "../../src/server/db/tables/part"
import { projectTable } from "../../src/server/db/tables/project"
import { sessionTable } from "../../src/server/db/tables/session"

beforeAll(() => {
	db.init(":memory:")
})

afterAll(() => {
	db.close()
})

beforeEach(() => {
	const d = db.get()
	// FK-safe wipe.
	d.delete(partTable).run()
	d.delete(messageTable).run()
	d.delete(sessionTable).run()
	d.delete(projectTable).run()
	upsertProject({ id: "proj1", name: "P", directory: "/work/proj" })
})

describe("createSession idempotency (client-supplied ULID)", () => {
	it("re-inserting the same id returns the original row, not a duplicate", () => {
		const id = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
		const a = createSession({ id, projectId: "proj1", directory: "/work/proj" })
		const b = createSession({ id, projectId: "proj1", directory: "/work/proj" })
		expect(b.id).toBe(a.id)
		expect(b.createdAt).toBe(a.createdAt)
		// Only one row exists for this id.
		expect(findSessionById(id)?.id).toBe(id)
	})

	it("preserves the title set on first insert when re-POSTed without a title", () => {
		const id = "01ARZ3NDEKTSV4RRFFQ69G5FAV"
		createSession({ id, projectId: "proj1", directory: "/work/proj", title: "First" })
		const second = createSession({ id, projectId: "proj1", directory: "/work/proj" })
		expect(second.title).toBe("First")
	})
})
