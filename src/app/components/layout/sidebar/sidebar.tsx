import type { Project, Session, SessionStatus } from "@core/schema"
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
}: SidebarProps) {
	return (
		<>
			<Titlebar />
			<SidebarHeader onNewProject={onNewProject} />
			<div className="min-h-0 flex-1 overflow-y-auto">
				{projects.map((project) => (
					<ProjectGroup
						key={project.id}
						project={project}
						sessions={sessionsByProject[project.id] ?? []}
						sessionStatuses={sessionStatuses}
						activeSessionId={activeSessionId}
						onSelectSession={onSelectSession}
						onNewSession={onNewSession}
					/>
				))}
			</div>
			<SidebarFooter onOpenSettings={onOpenSettings} />
		</>
	)
}
