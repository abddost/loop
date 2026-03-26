import type { Project, Session, SessionStatus } from "@core/schema"
import { useCallback, useState } from "react"
import { getProjectsCollapsed, setProjectsCollapsed } from "../../../lib/local-persistence"
import { Titlebar } from "../titlebar"
import { ProjectGroup } from "./project-group"
import { SidebarFooter } from "./sidebar-footer"
import { SidebarHeader } from "./sidebar-header"

export interface SidebarProps {
	projects: Project[]
	sessionsByProject: Record<string, Session[]>
	sessionStatuses?: Record<string, SessionStatus>
	activeSessionId?: string
	onSelectSession: (sessionId: string) => void
	onNewSession: (projectId: string) => void
	onNewProject: () => void
	onOpenSettings: () => void
	onRenameProject: (projectId: string, newName: string) => void
	onRemoveProject: (projectId: string) => void
	onArchiveSession: (sessionId: string) => void
}

/**
 * Full sidebar container with titlebar, project list, and settings footer.
 */
export function Sidebar({
	projects,
	sessionsByProject,
	sessionStatuses,
	activeSessionId,
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

	return (
		<>
			<Titlebar />
			<SidebarHeader
				onNewProject={onNewProject}
				allCollapsed={allCollapsed}
				onToggleCollapseAll={handleToggleCollapseAll}
			/>
			<div className="min-h-0 flex-1 overflow-y-auto">
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
