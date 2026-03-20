import type { Project, Session, SessionStatus } from "@core/schema"
import { FolderIcon, PlusIcon } from "@heroicons/react/24/outline"
import { useState } from "react"
import { cn } from "../../ui/cn"
import { SessionItem } from "./session-item"

export interface ProjectGroupProps {
	project: Project
	sessions: Session[]
	sessionStatuses?: Record<string, SessionStatus>
	activeSessionId?: string
	onSelectSession: (sessionId: string) => void
	onNewSession: (projectId: string) => void
}

/**
 * Collapsible project group in the sidebar.
 * Shows a folder icon with project name and its list of sessions.
 */
export function ProjectGroup({
	project,
	sessions,
	sessionStatuses,
	activeSessionId,
	onSelectSession,
	onNewSession,
}: ProjectGroupProps) {
	const [collapsed, setCollapsed] = useState(false)

	return (
		<div className="mb-1">
			<div className="group flex w-full items-center gap-1 px-3 py-0.5">
				<button
					type="button"
					className="flex flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-xs font-medium text-foreground transition-colors hover:text-foreground"
					onClick={() => setCollapsed(!collapsed)}
				>
					<FolderIcon className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
					<span className="truncate">{project.name}</span>
				</button>
				<button
					type="button"
					className={cn(
						"shrink-0 rounded-md p-0.5 text-muted opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100",
					)}
					onClick={() => onNewSession(project.id)}
					title={`New thread in ${project.name}`}
					aria-label={`New thread in ${project.name}`}
				>
					<PlusIcon className="h-3 w-3" aria-hidden="true" />
				</button>
			</div>
			{!collapsed && (
				<div className="mt-0.5">
					{sessions.length === 0 ? (
						<p className="px-8 py-1 text-xs text-muted">No threads</p>
					) : (
						sessions.map((s) => (
							<SessionItem
								key={s.id}
								session={s}
								status={sessionStatuses?.[s.id]}
								isActive={s.id === activeSessionId}
								onSelect={onSelectSession}
							/>
						))
					)}
				</div>
			)}
		</div>
	)
}
