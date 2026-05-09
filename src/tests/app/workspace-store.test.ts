import { afterEach, beforeEach, describe, expect, it } from "vitest"

// Storage shim — workspace-store doesn't read it directly, but other modules
// in its import chain (theme-engine, etc.) may.
const memory = new Map<string, string>()
;(globalThis as { localStorage?: Storage }).localStorage = {
	getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
	setItem: (k: string, v: string) => {
		memory.set(k, v)
	},
	removeItem: (k: string) => {
		memory.delete(k)
	},
	clear: () => memory.clear(),
} as Storage

import { workspaceStoreRegistry } from "../../app/stores/workspace-store"

const DIR = "/work/wstest"

function freshStore() {
	// Evict the existing store so getOrCreate returns a fresh instance with
	// untouched, mutable initial state (the previous one is held by immer in
	// frozen form and can't be reset in-place).
	workspaceStoreRegistry._evictForTesting(DIR)
	return workspaceStoreRegistry.getOrCreate(DIR)
}

const baseSession = (id: string, updatedAt: number, archivedAt: number | null = null) => ({
	id,
	title: null,
	directory: DIR,
	archivedAt,
	createdAt: 1000,
	updatedAt,
})

beforeEach(() => {
	memory.clear()
	freshStore()
})

afterEach(() => {
	freshStore()
})

describe("workspace-store: upsertSession", () => {
	it("inserts a new session at the front when absent", () => {
		const store = workspaceStoreRegistry.get(DIR)!
		store.getState().upsertSession(baseSession("a", 100) as never)
		expect(store.getState().sessions.map((s) => s.id)).toEqual(["a"])
	})

	it("merges by id, preferring incoming updatedAt >= current", () => {
		const store = workspaceStoreRegistry.get(DIR)!
		store.getState().upsertSession(baseSession("a", 100) as never)
		store.getState().upsertSession({ ...baseSession("a", 200), title: "newer" } as never)
		expect(store.getState().sessions.find((s) => s.id === "a")?.title).toBe("newer")
	})

	it("does not overwrite a newer local row with stale incoming data", () => {
		const store = workspaceStoreRegistry.get(DIR)!
		store.getState().upsertSession({ ...baseSession("a", 200), title: "fresh" } as never)
		store.getState().upsertSession({ ...baseSession("a", 100), title: "stale" } as never)
		expect(store.getState().sessions.find((s) => s.id === "a")?.title).toBe("fresh")
	})

	it("does not resurrect an archived session via upsert", () => {
		const store = workspaceStoreRegistry.get(DIR)!
		store.getState().upsertSession(baseSession("a", 100) as never)
		// Simulate archive via SSE-driven removeSession.
		store.getState().removeSession("a")
		expect(store.getState().sessions).toHaveLength(0)
		// Stale ensureSession completes with archivedAt set — should be ignored.
		store.getState().upsertSession(baseSession("a", 200, 12345) as never)
		expect(store.getState().sessions).toHaveLength(0)
	})
})

describe("workspace-store: initSessions is additive", () => {
	it("preserves entries that ensureSession upserted before bootstrap arrived", () => {
		const store = workspaceStoreRegistry.get(DIR)!
		// ensureSession upserted session "a" first.
		store.getState().upsertSession(baseSession("a", 200) as never)
		// Then bootstrap's /sessions response arrives with only "b".
		store.getState().initSessions([baseSession("b", 100) as never])
		const ids = store
			.getState()
			.sessions.map((s) => s.id)
			.sort()
		expect(ids).toEqual(["a", "b"])
	})

	it("prefers max(updatedAt) when same id appears in both bootstrap and existing", () => {
		const store = workspaceStoreRegistry.get(DIR)!
		store.getState().upsertSession({ ...baseSession("a", 100), title: "old" } as never)
		store
			.getState()
			.initSessions([{ ...baseSession("a", 200), title: "newer-from-bootstrap" } as never])
		expect(store.getState().sessions.find((s) => s.id === "a")?.title).toBe("newer-from-bootstrap")
	})
})

describe("workspace-store: setMessages preserves SSE-arrived messages", () => {
	const message = (id: string, createdAt: number, role = "user") => ({
		id,
		sessionId: "S",
		role,
		parts: [],
		createdAt,
	})

	it("merges by id, keeps locally-arrived messages not in server response", () => {
		const store = workspaceStoreRegistry.get(DIR)!
		// SSE delivered message m2 during the loader's fetch window.
		store.getState().setMessages("S", [message("m2", 200) as never])
		// Then the loader's GET /sessions/S response arrives with only m1 (older).
		store.getState().setMessages("S", [message("m1", 100) as never])
		const merged = (store.getState().messages.get("S") ?? []).map((m) => m.id)
		expect(merged).toEqual(["m1", "m2"])
	})

	it("server response overwrites a locally-held entry with the same id", () => {
		const store = workspaceStoreRegistry.get(DIR)!
		store
			.getState()
			.setMessages("S", [
				{ ...message("m1", 100), parts: [{ type: "text", text: "client" }] } as never,
			])
		store
			.getState()
			.setMessages("S", [
				{ ...message("m1", 100), parts: [{ type: "text", text: "server" }] } as never,
			])
		const m = (store.getState().messages.get("S") ?? [])[0]
		expect((m.parts as Array<{ text: string }>)[0].text).toBe("server")
	})
})
