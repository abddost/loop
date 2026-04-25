import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { apiClient } from "../lib/api-client"
import { workspaceStoreRegistry } from "./workspace-store"

// ── Types ──────────────────────────────────────────────────────────────

export interface FileEntry {
	name: string
	path: string
	type: "file" | "directory"
}

export interface GitChange {
	path: string
	oldPath?: string
	status: "new" | "modified" | "deleted" | "renamed" | "untracked"
	staged: boolean
	additions: number
	deletions: number
}

export interface FileDiff {
	diff: string
	additions: number
	deletions: number
}

export interface OpenFile {
	uri: string
	path: string
	content: string | null
	language: string
	binary: boolean
}

export interface BranchInfo {
	current: string | null
	local: string[]
	remote: string[]
}

export type DiffStyle = "unified" | "split"

// ── State ──────────────────────────────────────────────────────────────

interface FilePanelState {
	/** Panel UI */
	panelOpen: boolean
	panelWidth: number
	activeTab: "changes" | "files"
	treeWidth: number

	/** Current workspace */
	activeDir: string | null

	/** Per-workspace state */
	changesByDir: Record<string, GitChange[]>
	diffsByDir: Record<string, Record<string, FileDiff>>
	expandedChangesByDir: Record<string, Record<string, boolean>>
	treeByDir: Record<string, Record<string, FileEntry[]>>
	expandedByDir: Record<string, Record<string, boolean>>
	openFilesByDir: Record<string, OpenFile[]>
	activeFileByDir: Record<string, string | null>

	/** Review panel UI */
	diffStyle: DiffStyle
	forceLargeDiff: Record<string, boolean>

	/** Branch state (used by status-bar VcsStatus) */
	branches: BranchInfo | null
	branchesLoading: boolean

	/** Git operation state (discard, branch switch/create) */
	gitOperationLoading: boolean
	gitError: string | null

	/** Discard confirmation */
	discardTarget: GitChange | null

	/** Actions: panel */
	togglePanel(): void
	setPanelWidth(width: number): void
	setTreeWidth(width: number): void
	setActiveTab(tab: "changes" | "files"): void

	/** Actions: workspace */
	switchWorkspace(dir: string): void

	/** Actions: file tree */
	loadChildren(dirPath: string): Promise<void>
	toggleExpand(path: string): void

	/** Invalidate tree / open file from a file-watcher event. */
	invalidateFromWatcher(path: string, event: "add" | "change" | "unlink"): void

	/** Actions: open files */
	openFile(path: string): Promise<void>
	closeFile(uri: string): void
	setActiveFile(uri: string): void

	/** Actions: git status & diff */
	loadChanges(): Promise<void>
	toggleChangeExpanded(path: string): void
	setChangeExpanded(path: string, expanded: boolean): void
	loadDiff(path: string): Promise<void>

	/** Actions: review UI */
	setDiffStyle(style: DiffStyle): void
	forceRenderLargeDiff(path: string): void

	/** Actions: discard */
	requestDiscard(change: GitChange): void
	cancelDiscard(): void
	confirmDiscard(): Promise<void>

	/** Actions: branches */
	loadBranches(): Promise<void>
	switchBranch(branch: string): Promise<boolean>
	createBranch(name: string, checkout?: boolean): Promise<boolean>

	/** Actions: clear error */
	clearGitError(): void
}

// ── Constants ──────────────────────────────────────────────────────────

const MIN_PANEL_WIDTH = 300
const MAX_PANEL_WIDTH = 800
const DEFAULT_PANEL_WIDTH = 500

const MIN_TREE_WIDTH = 150
const MAX_TREE_WIDTH = 400
const DEFAULT_TREE_WIDTH = 220

/** Stable empty arrays for selectors */
const EMPTY_CHANGES: GitChange[] = []
const EMPTY_ENTRIES: FileEntry[] = []
const EMPTY_FILES: OpenFile[] = []

/**
 * In-flight tree fetches keyed by "directory:dirPath". Lets concurrent
 * invalidations (e.g., bulk file writes) dedupe to a single API call.
 */
const inflightTreeLoads = new Map<string, Promise<void>>()

function parentDir(path: string): string {
	const idx = path.lastIndexOf("/")
	return idx === -1 ? "." : path.slice(0, idx)
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Refresh the workspace store's branch info after git operations. */
function refreshWorkspaceBranch(dir: string): void {
	apiClient
		.get<{ branch: string; dirty: boolean }>("/vcs/branch", { directory: dir })
		.then((branch) => {
			const store = workspaceStoreRegistry.get(dir)
			if (store) store.getState().initVcs(branch)
		})
		.catch((err) => console.error("[file-panel] refreshWorkspaceBranch failed:", err))
}

// ── Store ──────────────────────────────────────────────────────────────

export const useFilePanelStore = create<FilePanelState>()(
	immer((set, get) => ({
		panelOpen: false,
		panelWidth: DEFAULT_PANEL_WIDTH,
		activeTab: "files",
		treeWidth: DEFAULT_TREE_WIDTH,
		activeDir: null,
		changesByDir: {},
		diffsByDir: {},
		expandedChangesByDir: {},
		treeByDir: {},
		expandedByDir: {},
		openFilesByDir: {},
		activeFileByDir: {},
		diffStyle: "unified",
		forceLargeDiff: {},
		branches: null,
		branchesLoading: false,
		gitOperationLoading: false,
		gitError: null,
		discardTarget: null,

		togglePanel() {
			set((s) => {
				s.panelOpen = !s.panelOpen
			})
		},

		setPanelWidth(width) {
			const clamped = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, width))
			set((s) => {
				s.panelWidth = clamped
			})
		},

		setTreeWidth(width) {
			const clamped = Math.min(MAX_TREE_WIDTH, Math.max(MIN_TREE_WIDTH, width))
			set((s) => {
				s.treeWidth = clamped
			})
		},

		setActiveTab(tab) {
			set((s) => {
				s.activeTab = tab
			})
		},

		switchWorkspace(dir) {
			const prev = get().activeDir
			if (prev === dir) return

			set((s) => {
				s.activeDir = dir
				if (!s.changesByDir[dir]) s.changesByDir[dir] = []
				if (!s.diffsByDir[dir]) s.diffsByDir[dir] = {}
				if (!s.expandedChangesByDir[dir]) s.expandedChangesByDir[dir] = {}
				if (!s.treeByDir[dir]) s.treeByDir[dir] = {}
				if (!s.expandedByDir[dir]) s.expandedByDir[dir] = {}
				if (!s.openFilesByDir[dir]) s.openFilesByDir[dir] = []
				if (s.activeFileByDir[dir] === undefined) s.activeFileByDir[dir] = null
			})

			// Fetch root tree and git changes in parallel
			Promise.all([get().loadChildren("."), get().loadChanges()]).catch((err) =>
				console.error("[file-panel] workspace init failed:", err),
			)
		},

		async loadChildren(dirPath) {
			const dir = get().activeDir
			if (!dir) return

			const key = `${dir}:${dirPath}`
			const existing = inflightTreeLoads.get(key)
			if (existing) return existing

			const promise = (async () => {
				try {
					const entries = await apiClient.get<FileEntry[]>(
						`/files/tree?path=${encodeURIComponent(dirPath)}`,
						{ directory: dir },
					)
					if (get().activeDir !== dir) return
					set((s) => {
						if (!s.treeByDir[dir]) s.treeByDir[dir] = {}
						s.treeByDir[dir][dirPath] = entries
					})
				} catch (err) {
					console.error("[file-panel] loadChildren failed:", err)
				} finally {
					inflightTreeLoads.delete(key)
				}
			})()

			inflightTreeLoads.set(key, promise)
			return promise
		},

		toggleExpand(path) {
			const dir = get().activeDir
			if (!dir) return

			set((s) => {
				if (!s.expandedByDir[dir]) s.expandedByDir[dir] = {}
				s.expandedByDir[dir][path] = !s.expandedByDir[dir][path]
			})

			const state = get()
			const expanded = state.expandedByDir[dir]?.[path]
			const loaded = state.treeByDir[dir]?.[path]
			if (expanded && !loaded) {
				state
					.loadChildren(path)
					.catch((err) => console.error("[file-panel] expand load failed:", err))
			}
		},

		invalidateFromWatcher(path, event) {
			const dir = get().activeDir
			if (!dir) return
			if (!path || path === ".git" || path.startsWith(".git/")) return

			if (event === "change") {
				// If the changed file is currently open, re-read its content.
				const openFile = get().openFilesByDir[dir]?.find((f) => f.path === path)
				if (!openFile) return
				apiClient
					.get<{ content: string; totalLines: number; language: string; binary: boolean }>(
						`/files/read?path=${encodeURIComponent(path)}`,
						{ directory: dir },
					)
					.then((result) => {
						if (get().activeDir !== dir) return
						set((s) => {
							const list = s.openFilesByDir[dir]
							if (!list) return
							const idx = list.findIndex((f) => f.uri === openFile.uri)
							if (idx === -1) return
							list[idx].content = result.binary ? null : result.content
							list[idx].language = result.language
							list[idx].binary = result.binary
						})
					})
					.catch(() => {})
				return
			}

			// add / unlink: refresh parent dir but only if already loaded.
			// Unloaded dirs are re-fetched fresh on user expand.
			const parent = parentDir(path)
			const parentLoaded = !!get().treeByDir[dir]?.[parent]
			if (!parentLoaded) return
			get()
				.loadChildren(parent)
				.catch((err) => console.error("[file-panel] invalidate parent failed:", err))
		},

		async openFile(path) {
			const dir = get().activeDir
			if (!dir) return

			const uri = `file://${encodeURIComponent(path)}`

			const existing = get().openFilesByDir[dir]?.find((f) => f.uri === uri)
			if (existing) {
				set((s) => {
					s.activeFileByDir[dir] = uri
					s.activeTab = "files"
				})
				return
			}

			try {
				const result = await apiClient.get<{
					content: string
					totalLines: number
					language: string
					binary: boolean
				}>(`/files/read?path=${encodeURIComponent(path)}`, { directory: dir })

				if (get().activeDir !== dir) return

				const file: OpenFile = {
					uri,
					path,
					content: result.binary ? null : result.content,
					language: result.language,
					binary: result.binary,
				}

				set((s) => {
					if (!s.openFilesByDir[dir]) s.openFilesByDir[dir] = []
					s.openFilesByDir[dir].push(file)
					s.activeFileByDir[dir] = uri
					s.activeTab = "files"
				})
			} catch (err) {
				console.error("[file-panel] openFile failed:", err)
			}
		},

		closeFile(uri) {
			const dir = get().activeDir
			if (!dir) return

			set((s) => {
				const list = s.openFilesByDir[dir]
				if (!list) return
				const idx = list.findIndex((f) => f.uri === uri)
				if (idx === -1) return
				list.splice(idx, 1)

				if (s.activeFileByDir[dir] === uri) {
					s.activeFileByDir[dir] = list.length > 0 ? list[Math.max(0, idx - 1)].uri : null
				}
			})
		},

		setActiveFile(uri) {
			const dir = get().activeDir
			if (!dir) return
			set((s) => {
				s.activeFileByDir[dir] = uri
			})
		},

		async loadChanges() {
			const dir = get().activeDir
			if (!dir) return

			try {
				const changes = await apiClient.get<GitChange[]>("/vcs/status", { directory: dir })
				if (get().activeDir !== dir) return

				// Build set of current paths for invalidation
				const newPaths = new Set(changes.map((c) => c.path))

				set((s) => {
					s.changesByDir[dir] = changes
					// Only remove diffs for files no longer in the changes list
					const diffs = s.diffsByDir[dir]
					if (diffs) {
						for (const path of Object.keys(diffs)) {
							if (!newPaths.has(path)) {
								delete diffs[path]
							}
						}
					}
					// Drop stale large-diff overrides
					for (const path of Object.keys(s.forceLargeDiff)) {
						if (!newPaths.has(path)) delete s.forceLargeDiff[path]
					}
				})

				// Re-fetch diffs for files that are currently expanded
				const expanded = get().expandedChangesByDir[dir]
				if (expanded) {
					for (const path of Object.keys(expanded)) {
						if (expanded[path] && newPaths.has(path)) {
							get()
								.loadDiff(path)
								.catch((err) => console.error("[file-panel] re-fetch diff failed:", err))
						}
					}
				}
			} catch (err) {
				console.error("[file-panel] loadChanges failed:", err)
			}
		},

		toggleChangeExpanded(path) {
			const dir = get().activeDir
			if (!dir) return

			const wasExpanded = get().expandedChangesByDir[dir]?.[path]
			set((s) => {
				if (!s.expandedChangesByDir[dir]) s.expandedChangesByDir[dir] = {}
				s.expandedChangesByDir[dir][path] = !wasExpanded
			})

			// Load diff when expanding (always fetch fresh)
			if (!wasExpanded) {
				get()
					.loadDiff(path)
					.catch((err) => console.error("[file-panel] loadDiff failed:", err))
			}
		},

		setChangeExpanded(path, expanded) {
			const dir = get().activeDir
			if (!dir) return

			const prev = get().expandedChangesByDir[dir]?.[path] ?? false
			if (prev === expanded) return

			set((s) => {
				if (!s.expandedChangesByDir[dir]) s.expandedChangesByDir[dir] = {}
				s.expandedChangesByDir[dir][path] = expanded
			})

			if (expanded) {
				get()
					.loadDiff(path)
					.catch((err) => console.error("[file-panel] loadDiff failed:", err))
			}
		},

		async loadDiff(path) {
			const dir = get().activeDir
			if (!dir) return

			try {
				const result = await apiClient.get<{
					diff: string
					additions: number
					deletions: number
				}>(`/vcs/diff?path=${encodeURIComponent(path)}`, { directory: dir })

				if (get().activeDir !== dir) return
				set((s) => {
					if (!s.diffsByDir[dir]) s.diffsByDir[dir] = {}
					s.diffsByDir[dir][path] = result
				})
			} catch (err) {
				console.error("[file-panel] loadDiff failed:", err)
			}
		},

		setDiffStyle(style) {
			set((s) => {
				s.diffStyle = style
			})
		},

		forceRenderLargeDiff(path) {
			set((s) => {
				s.forceLargeDiff[path] = true
			})
		},

		// ── Discard ─────────────────────────────────────────────────

		requestDiscard(change) {
			set((s) => {
				s.discardTarget = change
			})
		},

		cancelDiscard() {
			set((s) => {
				s.discardTarget = null
			})
		},

		async confirmDiscard() {
			const target = get().discardTarget
			if (!target) return

			const dir = get().activeDir
			if (!dir) return

			set((s) => {
				s.discardTarget = null
				s.gitOperationLoading = true
				s.gitError = null
			})

			try {
				await apiClient.post("/vcs/revert", { path: target.path }, { directory: dir })
				await get().loadChanges()
			} catch (err) {
				const message = err instanceof Error ? err.message : "Failed to discard changes"
				set((s) => {
					s.gitError = message
				})
			} finally {
				set((s) => {
					s.gitOperationLoading = false
				})
			}
		},

		// ── Branches ────────────────────────────────────────────────

		async loadBranches() {
			const dir = get().activeDir
			if (!dir) return

			set((s) => {
				s.branchesLoading = true
			})

			try {
				const branches = await apiClient.get<BranchInfo>("/vcs/branches", { directory: dir })
				if (get().activeDir !== dir) return
				set((s) => {
					s.branches = branches
					s.branchesLoading = false
				})
			} catch (err) {
				console.error("[file-panel] loadBranches failed:", err)
				set((s) => {
					s.branchesLoading = false
				})
			}
		},

		async switchBranch(branch) {
			const dir = get().activeDir
			if (!dir) return false

			set((s) => {
				s.gitOperationLoading = true
				s.gitError = null
			})

			try {
				await apiClient.post("/vcs/switch", { branch }, { directory: dir })
				await Promise.all([get().loadChanges(), get().loadBranches()])
				refreshWorkspaceBranch(dir)
				return true
			} catch (err) {
				const msg = err instanceof Error ? err.message : "Branch switch failed"
				set((s) => {
					s.gitError = msg
				})
				return false
			} finally {
				set((s) => {
					s.gitOperationLoading = false
				})
			}
		},

		async createBranch(name, checkout = true) {
			const dir = get().activeDir
			if (!dir) return false

			set((s) => {
				s.gitOperationLoading = true
				s.gitError = null
			})

			try {
				await apiClient.post("/vcs/create-branch", { name, checkout }, { directory: dir })
				await get().loadBranches()
				refreshWorkspaceBranch(dir)
				return true
			} catch (err) {
				const msg = err instanceof Error ? err.message : "Branch creation failed"
				set((s) => {
					s.gitError = msg
				})
				return false
			} finally {
				set((s) => {
					s.gitOperationLoading = false
				})
			}
		},

		clearGitError() {
			set((s) => {
				s.gitError = null
			})
		},
	})),
)

// ── Push git errors to snackbar ────────────────────────────────────────

import { useSnackbarStore } from "./snackbar-store"

let prevGitError: string | null = null
useFilePanelStore.subscribe((state) => {
	if (state.gitError && state.gitError !== prevGitError) {
		useSnackbarStore.getState().push(state.gitError, "error")
	}
	prevGitError = state.gitError
})

// ── Selectors ──────────────────────────────────────────────────────────

export function selectChanges(s: FilePanelState): GitChange[] {
	if (!s.activeDir) return EMPTY_CHANGES
	return s.changesByDir[s.activeDir] ?? EMPTY_CHANGES
}

export function selectRootTree(s: FilePanelState): FileEntry[] {
	if (!s.activeDir) return EMPTY_ENTRIES
	return s.treeByDir[s.activeDir]?.["."] ?? EMPTY_ENTRIES
}

export function selectOpenFiles(s: FilePanelState): OpenFile[] {
	if (!s.activeDir) return EMPTY_FILES
	return s.openFilesByDir[s.activeDir] ?? EMPTY_FILES
}

export function selectActiveFileUri(s: FilePanelState): string | null {
	if (!s.activeDir) return null
	return s.activeFileByDir[s.activeDir] ?? null
}

export function selectTreeChildren(s: FilePanelState, dirPath: string): FileEntry[] {
	if (!s.activeDir) return EMPTY_ENTRIES
	return s.treeByDir[s.activeDir]?.[dirPath] ?? EMPTY_ENTRIES
}

export function selectIsExpanded(s: FilePanelState, path: string): boolean {
	if (!s.activeDir) return false
	return s.expandedByDir[s.activeDir]?.[path] ?? false
}

export function selectIsChangeExpanded(s: FilePanelState, path: string): boolean {
	if (!s.activeDir) return false
	return s.expandedChangesByDir[s.activeDir]?.[path] ?? false
}

export function selectFileDiff(s: FilePanelState, path: string): FileDiff | null {
	if (!s.activeDir) return null
	return s.diffsByDir[s.activeDir]?.[path] ?? null
}
