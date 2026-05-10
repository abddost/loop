import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { apiClient } from "../lib/api-client"
import { useFilePanelStore } from "./file-panel-store"

interface QuickOpenState {
	open: boolean
	query: string
	files: string[]
	loading: boolean
	error: string | null
	lastLoadedDir: string | null

	openModal(): void
	closeModal(): void
	setQuery(q: string): void
	/** Fetch the workspace file list if not already cached for the active dir.
	 *  Used by both the Cmd+P modal and the @-mention menu so they share one
	 *  cache entry. Idempotent — concurrent calls with the same dir dedupe. */
	loadFiles(): void
}

export const useQuickOpenStore = create<QuickOpenState>()(
	immer((set, get) => ({
		open: false,
		query: "",
		files: [],
		loading: false,
		error: null,
		lastLoadedDir: null,

		openModal() {
			const dir = useFilePanelStore.getState().activeDir
			if (!dir) return

			set((s) => {
				s.open = true
				s.query = ""
			})

			get().loadFiles()
		},

		closeModal() {
			set((s) => {
				s.open = false
				s.query = ""
			})
		},

		setQuery(q) {
			set((s) => {
				s.query = q
			})
		},

		loadFiles() {
			const dir = useFilePanelStore.getState().activeDir
			if (!dir) return
			if (get().lastLoadedDir === dir) return
			if (get().loading) return

			set((s) => {
				s.loading = true
				s.error = null
			})
			apiClient
				.get<{ files: string[]; truncated: boolean }>("/files/list", { directory: dir })
				.then((result) => {
					if (useFilePanelStore.getState().activeDir !== dir) return
					set((s) => {
						s.files = result.files
						s.lastLoadedDir = dir
						s.loading = false
					})
				})
				.catch((err) => {
					set((s) => {
						s.error = err instanceof Error ? err.message : "Failed to load files"
						s.loading = false
					})
				})
		},
	})),
)

// ── Fuzzy match ─────────────────────────────────────────────────────
//
// Simple subsequence-based scoring: exact basename match wins, then
// substring on basename, then subsequence on full path. Cheap enough
// to run on every keystroke against ~10k entries without virtualization.

export interface QuickOpenMatch {
	path: string
	basename: string
	score: number
	matches: number[] // character indices in `path` that matched
}

function basenameOf(path: string): string {
	const idx = path.lastIndexOf("/")
	return idx === -1 ? path : path.slice(idx + 1)
}

function scoreMatch(query: string, path: string, basename: string): QuickOpenMatch | null {
	const q = query.toLowerCase()
	const p = path.toLowerCase()
	const b = basename.toLowerCase()
	const baseStart = path.length - basename.length

	// Exact basename match — highest tier
	if (b === q) {
		return {
			path,
			basename,
			score: 1_000_000,
			matches: Array.from({ length: basename.length }, (_, i) => baseStart + i),
		}
	}

	// Substring on basename
	const subIdx = b.indexOf(q)
	if (subIdx !== -1) {
		return {
			path,
			basename,
			score: 100_000 - subIdx,
			matches: Array.from({ length: q.length }, (_, i) => baseStart + subIdx + i),
		}
	}

	// Substring on full path
	const pathIdx = p.indexOf(q)
	if (pathIdx !== -1) {
		return {
			path,
			basename,
			score: 50_000 - pathIdx,
			matches: Array.from({ length: q.length }, (_, i) => pathIdx + i),
		}
	}

	// Subsequence over full path
	let pi = 0
	const hits: number[] = []
	for (const ch of q) {
		while (pi < p.length && p[pi] !== ch) pi++
		if (pi === p.length) return null
		hits.push(pi)
		pi++
	}
	const span = hits[hits.length - 1] - hits[0]
	return { path, basename, score: 10_000 - span, matches: hits }
}

export function rankMatches(query: string, files: string[], limit = 200): QuickOpenMatch[] {
	if (!query) {
		return files.slice(0, limit).map((path) => ({
			path,
			basename: basenameOf(path),
			score: 0,
			matches: [],
		}))
	}

	const results: QuickOpenMatch[] = []
	for (const path of files) {
		const m = scoreMatch(query, path, basenameOf(path))
		if (m) results.push(m)
	}
	results.sort((a, b) => b.score - a.score)
	return results.slice(0, limit)
}
