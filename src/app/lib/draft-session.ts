/**
 * Client-side draft sessions.
 *
 * A draft is a session whose ULID was generated locally and that has not yet
 * been POSTed to the server. The draft lets the new-session view live behind
 * a real session URL (`/workspace/$dir/session/$ulid`) without a server
 * round-trip on the "New Session" click — which eliminates the navigation
 * race where the URL has an id the DB hasn't committed yet.
 *
 * Drafts are persisted in localStorage with a 24h TTL so refresh during a
 * draft survives, but stale drafts don't accumulate forever.
 */
import { ulid } from "@core/id"
import type { SubmitFiles } from "../components/input/input-bar"

const KEY = "loop:drafts:v1"
const TTL_MS = 24 * 60 * 60 * 1000

export interface Draft {
	id: string
	directory: string
	text?: string
	files?: SubmitFiles[]
	worktree?: string
	createdAt: number
}

function readAll(): Draft[] {
	let raw: string | null
	try {
		raw = localStorage.getItem(KEY)
	} catch {
		return []
	}
	if (!raw) return []
	try {
		const parsed = JSON.parse(raw)
		if (!Array.isArray(parsed)) return []
		return parsed.filter(
			(d): d is Draft =>
				d &&
				typeof d.id === "string" &&
				typeof d.directory === "string" &&
				typeof d.createdAt === "number",
		)
	} catch {
		return []
	}
}

function writeAll(drafts: Draft[]): void {
	try {
		if (drafts.length === 0) localStorage.removeItem(KEY)
		else localStorage.setItem(KEY, JSON.stringify(drafts))
	} catch {
		// Storage unavailable — silently ignore.
	}
}

function evictExpired(drafts: Draft[]): Draft[] {
	const cutoff = Date.now() - TTL_MS
	return drafts.filter((d) => d.createdAt >= cutoff)
}

export function createDraft(directory: string): Draft {
	const draft: Draft = { id: ulid(), directory, createdAt: Date.now() }
	const drafts = evictExpired(readAll())
	drafts.push(draft)
	writeAll(drafts)
	return draft
}

export function getDraft(id: string): Draft | undefined {
	const drafts = evictExpired(readAll())
	return drafts.find((d) => d.id === id)
}

export function updateDraft(id: string, patch: Partial<Omit<Draft, "id" | "createdAt">>): void {
	const drafts = evictExpired(readAll())
	const idx = drafts.findIndex((d) => d.id === id)
	if (idx < 0) return
	drafts[idx] = { ...drafts[idx], ...patch }
	writeAll(drafts)
}

/** Remove the draft from storage — call after the server has accepted the POST. */
export function commitDraft(id: string): void {
	const drafts = evictExpired(readAll()).filter((d) => d.id !== id)
	writeAll(drafts)
}

/** Read all live (non-expired) drafts. Side-effect: prunes expired entries from storage. */
export function listDrafts(): Draft[] {
	const drafts = readAll()
	const live = evictExpired(drafts)
	if (live.length !== drafts.length) writeAll(live)
	return live
}
