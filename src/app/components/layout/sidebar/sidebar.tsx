import type { Project, Session, SessionStatus } from "@core/schema"
import { PencilSquare } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useMemo, useState } from "react"
import { getProjectsCollapsed, setProjectsCollapsed } from "../../../lib/local-persistence"
import { usePinStore } from "../../../stores/pin-store"
import { workspaceStoreRegistry } from "../../../stores/workspace-store"
import { useWorktreeStore } from "../../../stores/worktree-store"
import { Tooltip } from "../../ui/tooltip"
import { Titlebar } from "../titlebar"
import { ProjectGroup } from "./project-group"
import { SessionItem } from "./session-item"
import { SidebarFooter } from "./sidebar-footer"
import { SidebarHeader } from "./sidebar-header"

export interface SidebarProps {
	projects: Project[]
	sessionsByProject: Record<string, Session[]>
	sessionStatuses?: Record<string, SessionStatus>
	activeSessionId?: string
	activeProjectId?: string | null
	onSelectSession: (sessionId: string, directory: string) => void
	onNewSession: (projectId: string) => void
	onNewProject: () => void
	onOpenSettings: () => void
	onRenameProject: (projectId: string, newName: string) => void
	onRemoveProject: (projectId: string) => void
	onArchiveSession: (sessionId: string, directory: string) => void
}

/**
 * Full sidebar container with titlebar, project list, and settings footer.
 */
export function Sidebar({
	projects,
	sessionsByProject,
	sessionStatuses,
	activeSessionId,
	activeProjectId,
	onSelectSession,
	onNewSession,
	onNewProject,
	onOpenSettings,
	onRenameProject,
	onRemoveProject,
	onArchiveSession,
}: SidebarProps) {
	// Collapse signal: increments on each toggle. Odd = collapsed, even = expanded.
	// Using a counter instead of a boolean so ProjectGroup can detect changes
	// even when the user individually toggles a project in between.
	// Initialized from localStorage so the state survives reloads.
	const [collapseSignal, setCollapseSignal] = useState(() => (getProjectsCollapsed() ? 1 : 0))
	const allCollapsed = collapseSignal % 2 === 1

	const handleToggleCollapseAll = useCallback(() => {
		setCollapseSignal((prev) => {
			const next = prev + 1
			setProjectsCollapsed(next % 2 === 1)
			return next
		})
	}, [])

	// Collect pinned sessions from across all projects
	const pinnedIds = usePinStore((s) => s.pinnedIds)
	const pinnedSessions = useMemo(() => {
		if (pinnedIds.size === 0) return []
		const all: Session[] = []
		for (const sessions of Object.values(sessionsByProject)) {
			for (const s of sessions) {
				if (pinnedIds.has(s.id)) all.push(s)
			}
		}
		// Sort by most recently updated
		return all.sort((a, b) => b.updatedAt - a.updatedAt)
	}, [sessionsByProject, pinnedIds])

	// Build worktree directory → branch map for pinned sessions
	const allWorktrees = useWorktreeStore((s) => s.worktrees)
	const worktreeBranchByDir = useMemo(() => {
		const map = new Map<string, string>()
		for (const wt of allWorktrees.values()) {
			map.set(wt.directory, wt.branch)
		}
		return map
	}, [allWorktrees])

	// Build project directory → main branch map for pinned sessions
	const projectDirBySessionDir = useMemo(() => {
		const map = new Map<string, string>()
		for (const p of projects) {
			for (const s of sessionsByProject[p.id] ?? []) {
				map.set(s.directory, p.directory)
			}
		}
		return map
	}, [projects, sessionsByProject])

	const getBranchForSession = useCallback(
		(session: Session) => {
			const wtBranch = worktreeBranchByDir.get(session.directory)
			if (wtBranch) return { worktreeBranch: wtBranch, gitBranch: undefined }
			// Fall back to main branch from workspace store
			const projDir = projectDirBySessionDir.get(session.directory) ?? session.directory
			const branch = workspaceStoreRegistry.get(projDir)?.getState().vcsBranch?.branch
			return { worktreeBranch: undefined, gitBranch: branch }
		},
		[worktreeBranchByDir, projectDirBySessionDir],
	)

	return (
		<>
			<Titlebar />
			<div className="px-2 pb-1 pt-0.5">
				<Tooltip content="New session" shortcut="session.new" side="right" className="block w-full">
					<button
						type="button"
						onClick={() => activeProjectId && onNewSession(activeProjectId)}
						disabled={!activeProjectId}
						className="el-surface-hover flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[13px] font-medium text-foreground/85 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
					>
						<PencilSquare className="h-4 w-4 shrink-0" aria-hidden="true" />
						<span>New session</span>
					</button>
				</Tooltip>
			</div>
			<SidebarHeader
				onNewProject={onNewProject}
				allCollapsed={allCollapsed}
				onToggleCollapseAll={handleToggleCollapseAll}
			/>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{/* Pinned sessions — flat list above all projects */}
				{pinnedSessions.length > 0 && (
					<div className="mb-1">
						<div className="px-2">
							{pinnedSessions.map((s) => {
								const { worktreeBranch, gitBranch } = getBranchForSession(s)
								return (
									<SessionItem
										key={s.id}
										session={s}
										status={sessionStatuses?.[s.id]}
										isActive={s.id === activeSessionId}
										worktreeBranch={worktreeBranch}
										gitBranch={gitBranch}
										onSelect={onSelectSession}
										onArchive={onArchiveSession}
									/>
								)
							})}
						</div>
						<div className="mx-3 my-1 el-separator" />
					</div>
				)}

				{projects.map((project) => (
					<ProjectGroup
						key={project.id}
						project={project}
						sessions={sessionsByProject[project.id] ?? []}
						sessionStatuses={sessionStatuses}
						activeSessionId={activeSessionId}
						collapseSignal={collapseSignal}
						onSelectSession={onSelectSession}
						onNewSession={onNewSession}
						onRenameProject={onRenameProject}
						onRemoveProject={onRemoveProject}
						onArchiveSession={onArchiveSession}
					/>
				))}
			</div>
			<SidebarFooter onOpenSettings={onOpenSettings} />
		</>
	)
}
