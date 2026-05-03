import type { SandboxStatus } from "@core/schema/sandbox"
import { create } from "zustand"
import { immer } from "zustand/middleware/immer"

export interface WorktreeInfo {
	id: string
	directory: string
	parentDirectory: string
	name: string
	branch: string
	status: SandboxStatus
	error?: string
	createdAt: number
}

/**
 * Sentinel values for `newSessionWorktree`:
 *   - "main"    → use the project's main directory (default).
 *   - "create"  → create a new git worktree before starting the session.
 *   - "cursor"  → use the main directory BUT route the session through the
 *                 Cursor SDK runtime. Visual indicator only — backend
 *                 dispatch already routes by model.providerId, so picking
 *                 a Cursor model still works without selecting this mode.
 *                 Selecting "cursor" here pre-flags the session for the
 *                 model picker / status indicator UI.
 *   - any other string → an existing worktree's directory path.
 */
export const WORKSPACE_MODE_CURSOR = "cursor" as const

interface WorktreeStoreState {
	/** All known worktrees indexed by directory path. */
	worktrees: Map<string, WorktreeInfo>
	/** Directories currently being created/bootstrapped. */
	busyWorktrees: Set<string>
	/** For new-session UI: which worktree target the user selected. */
	newSessionWorktree: "main" | "create" | "cursor" | string

	// ─── Actions ──────────────────────────────────────────────────
	initWorktrees: (parentDirectory: string, worktrees: WorktreeInfo[]) => void
	addWorktree: (worktree: WorktreeInfo) => void
	removeWorktree: (directory: string) => void
	setWorktreeStatus: (directory: string, status: SandboxStatus, error?: string) => void
	setBusy: (directory: string, busy: boolean) => void
	setNewSessionWorktree: (target: "main" | "create" | "cursor" | string) => void
}

export const useWorktreeStore = create<WorktreeStoreState>()(
	immer((set) => ({
		worktrees: new Map(),
		busyWorktrees: new Set(),
		newSessionWorktree: "main",

		initWorktrees: (parentDirectory, worktrees) =>
			set((state) => {
				// Clear existing worktrees for this parent
				for (const [dir, wt] of state.worktrees) {
					if (wt.parentDirectory === parentDirectory) {
						state.worktrees.delete(dir)
					}
				}
				for (const wt of worktrees) {
					state.worktrees.set(wt.directory, wt)
				}
			}),

		addWorktree: (worktree) =>
			set((state) => {
				state.worktrees.set(worktree.directory, worktree)
			}),

		removeWorktree: (directory) =>
			set((state) => {
				state.worktrees.delete(directory)
				state.busyWorktrees.delete(directory)
			}),

		setWorktreeStatus: (directory, status, error) =>
			set((state) => {
				const wt = state.worktrees.get(directory)
				if (wt) {
					wt.status = status
					wt.error = error
				}
			}),

		setBusy: (directory, busy) =>
			set((state) => {
				if (busy) {
					state.busyWorktrees.add(directory)
				} else {
					state.busyWorktrees.delete(directory)
				}
			}),

		setNewSessionWorktree: (target) =>
			set((state) => {
				state.newSessionWorktree = target
			}),
	})),
)
