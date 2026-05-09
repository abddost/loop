import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Provide a minimal localStorage shim before importing the module under test.
// vitest's `node` environment doesn't ship one.
const memory = new Map<string, string>()
const localStorageShim = {
	getItem: (key: string) => (memory.has(key) ? memory.get(key)! : null),
	setItem: (key: string, value: string) => {
		memory.set(key, value)
	},
	removeItem: (key: string) => {
		memory.delete(key)
	},
	clear: () => {
		memory.clear()
	},
} as Storage
;(globalThis as { localStorage?: Storage }).localStorage = localStorageShim

// Module under test must be imported AFTER the shim is in place.
import {
	commitDraft,
	createDraft,
	getDraft,
	listDrafts,
	updateDraft,
} from "../../app/lib/draft-session"

beforeEach(() => {
	memory.clear()
	vi.useRealTimers()
})

afterEach(() => {
	vi.useRealTimers()
})

describe("draft-session", () => {
	it("createDraft persists a draft with a fresh ULID and returns it", () => {
		const d = createDraft("/work/proj")
		expect(d.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i)
		expect(d.directory).toBe("/work/proj")
		expect(typeof d.createdAt).toBe("number")
		expect(getDraft(d.id)).toEqual(d)
	})

	it("getDraft returns undefined for unknown ids", () => {
		expect(getDraft("nope")).toBeUndefined()
	})

	it("updateDraft patches mutable fields, leaves id and createdAt intact", () => {
		const d = createDraft("/work/proj")
		updateDraft(d.id, { text: "hello", worktree: "main" })
		const updated = getDraft(d.id)
		expect(updated?.id).toBe(d.id)
		expect(updated?.createdAt).toBe(d.createdAt)
		expect(updated?.text).toBe("hello")
		expect(updated?.worktree).toBe("main")
	})

	it("commitDraft removes the draft from storage", () => {
		const d = createDraft("/work/proj")
		expect(getDraft(d.id)).toBeDefined()
		commitDraft(d.id)
		expect(getDraft(d.id)).toBeUndefined()
	})

	it("listDrafts returns live entries and prunes expired ones", () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date("2026-04-01T00:00:00Z"))
		const oldDraft = createDraft("/work/old")

		// Jump past the 24h TTL.
		vi.setSystemTime(new Date("2026-04-03T00:00:00Z"))
		const freshDraft = createDraft("/work/new")

		const live = listDrafts()
		expect(live.map((d) => d.id)).toEqual([freshDraft.id])
		// Side-effect: pruned entry is gone from storage.
		expect(getDraft(oldDraft.id)).toBeUndefined()
	})

	it("survives malformed JSON in storage without throwing", () => {
		localStorageShim.setItem("loop:drafts:v1", "{not json")
		expect(listDrafts()).toEqual([])
		expect(() => createDraft("/work/proj")).not.toThrow()
	})

	it("multi-tab safe: two drafts with distinct ULIDs coexist", () => {
		const a = createDraft("/work/proj")
		const b = createDraft("/work/proj")
		expect(a.id).not.toBe(b.id)
		expect(
			listDrafts()
				.map((d) => d.id)
				.sort(),
		).toEqual([a.id, b.id].sort())
	})
})
