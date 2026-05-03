import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Provide a localStorage shim so modules in the import chain don't crash.
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

import { ApiError, apiClient } from "../../src/app/lib/api-client"
import {
	SessionNotFoundError,
	_resetDedupeForTesting,
	ensureSession,
} from "../../src/app/lib/session-loader"
import { workspaceStoreRegistry } from "../../src/app/stores/workspace-store"

const DIR = "/work/proj"
const SID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"

function makeServerSession(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: SID,
		title: null,
		directory: DIR,
		permissionMode: "default",
		permission: null,
		archivedAt: null,
		createdAt: 1000,
		updatedAt: 1000,
		messages: [],
		...overrides,
	}
}

// Spy on the singleton's `get` method directly. This works regardless of how
// each consumer (session-loader, etc.) imports the module — they all touch
// the same `apiClient` instance.
let getSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
	memory.clear()
	workspaceStoreRegistry._evictForTesting(DIR)
	getSpy = vi.spyOn(apiClient, "get") as unknown as ReturnType<typeof vi.spyOn>
})

afterEach(() => {
	const store = workspaceStoreRegistry.get(DIR)
	if (store) _resetDedupeForTesting(store)
	getSpy.mockRestore()
})

describe("ensureSession", () => {
	it("fast-path: resolves immediately if session + messages already in store", async () => {
		const store = workspaceStoreRegistry.getOrCreate(DIR)
		store.getState().upsertSession({
			id: SID,
			title: null,
			directory: DIR,
			archivedAt: null,
			createdAt: 1000,
			updatedAt: 1000,
		} as never)
		store.getState().setMessages(SID, [])

		await ensureSession(store, SID, DIR)
		expect(getSpy).not.toHaveBeenCalled()
	})

	it("populates s.sessions and s.messages on cold load", async () => {
		const store = workspaceStoreRegistry.getOrCreate(DIR)
		_resetDedupeForTesting(store)
		getSpy.mockResolvedValueOnce(makeServerSession({ title: "Hello" }))

		await ensureSession(store, SID, DIR)

		const session = store.getState().sessions.find((s) => s.id === SID)
		expect(session?.title).toBe("Hello")
		expect(store.getState().messages.has(SID)).toBe(true)
	})

	it("dedupes concurrent calls — single underlying fetch", async () => {
		const store = workspaceStoreRegistry.getOrCreate(DIR)
		_resetDedupeForTesting(store)
		let resolveFetch!: (val: unknown) => void
		getSpy.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveFetch = resolve
				}),
		)

		const a = ensureSession(store, SID, DIR)
		const b = ensureSession(store, SID, DIR)
		const c = ensureSession(store, SID, DIR)
		expect(getSpy).toHaveBeenCalledTimes(1)

		resolveFetch(makeServerSession())
		await Promise.all([a, b, c])
		expect(getSpy).toHaveBeenCalledTimes(1)
	})

	it("throws SessionNotFoundError on 404 (no retry)", async () => {
		const store = workspaceStoreRegistry.getOrCreate(DIR)
		_resetDedupeForTesting(store)
		getSpy.mockRejectedValueOnce(new ApiError(404, "not found", `/sessions/${SID}`))

		await expect(ensureSession(store, SID, DIR)).rejects.toBeInstanceOf(SessionNotFoundError)
		expect(getSpy).toHaveBeenCalledTimes(1) // No retry on 404.
	})

	it("treats archived sessions as not-found", async () => {
		const store = workspaceStoreRegistry.getOrCreate(DIR)
		_resetDedupeForTesting(store)
		getSpy.mockResolvedValueOnce(makeServerSession({ archivedAt: 12345 }))

		await expect(ensureSession(store, SID, DIR)).rejects.toBeInstanceOf(SessionNotFoundError)
	})

	it("retries transient failures and resolves on eventual success", async () => {
		const store = workspaceStoreRegistry.getOrCreate(DIR)
		_resetDedupeForTesting(store)
		getSpy
			.mockRejectedValueOnce(new ApiError(500, "boom", `/sessions/${SID}`))
			.mockResolvedValueOnce(makeServerSession({ title: "Recovered" }))

		await ensureSession(store, SID, DIR)
		expect(getSpy).toHaveBeenCalledTimes(2)
		const session = store.getState().sessions.find((s) => s.id === SID)
		expect(session?.title).toBe("Recovered")
	})

	it("aborts cleanly when the caller signal aborts before fetch resolves", async () => {
		const store = workspaceStoreRegistry.getOrCreate(DIR)
		_resetDedupeForTesting(store)
		// Fetch never resolves on its own — only the abort path should settle the
		// caller's wrapping promise.
		getSpy.mockImplementationOnce(() => new Promise(() => {}))
		const controller = new AbortController()
		const p = ensureSession(store, SID, DIR, { signal: controller.signal })
		controller.abort()
		await expect(p).rejects.toMatchObject({ name: "AbortError" })
	})

	it("aborting one caller does not poison subsequent callers (decoupled abort)", async () => {
		const store = workspaceStoreRegistry.getOrCreate(DIR)
		_resetDedupeForTesting(store)
		let resolveFetch!: (val: unknown) => void
		getSpy.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveFetch = resolve
				}),
		)

		const ctlA = new AbortController()
		const a = ensureSession(store, SID, DIR, { signal: ctlA.signal })
		const b = ensureSession(store, SID, DIR) // no signal — should still resolve

		// Caller A bails out — must not cancel the shared fetch for B.
		ctlA.abort()
		await expect(a).rejects.toMatchObject({ name: "AbortError" })

		resolveFetch(makeServerSession({ title: "B saw it" }))
		await expect(b).resolves.toBeUndefined()
		expect(store.getState().sessions.find((s) => s.id === SID)?.title).toBe("B saw it")
	})

	it("rejects malformed responses after exhausting retries", async () => {
		const store = workspaceStoreRegistry.getOrCreate(DIR)
		_resetDedupeForTesting(store)
		// Server returns 200s with an unusable shape every time.
		getSpy.mockResolvedValue({ id: SID, messages: "not-an-array" } as unknown as never)

		await expect(ensureSession(store, SID, DIR)).rejects.toThrow(/Malformed/)
		// Malformed is treated as transient (retried).
		expect(getSpy).toHaveBeenCalledTimes(3)
	})
})
