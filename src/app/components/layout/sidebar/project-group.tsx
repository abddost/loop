import type { Project, Session, SessionStatus } from "@core/schema"
import { Folder, Plus } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "../../ui/cn"
import { ProjectContextMenu } from "./project-context-menu"
import { SessionItem } from "./session-item"

export interface ProjectGroupProps {
	project: Project
	sessions: Session[]
	sessionStatuses?: Record<string, SessionStatus>
	activeSessionId?: string
	/** Increments each time "collapse all" or "expand all" is toggled. Even = expanded, odd = collapsed. */
	collapseSignal: number
	onSelectSession: (sessionId: string) => void
	onNewSession: (projectId: string) => void
	onRenameProject: (projectId: string, newName: string) => void
	onRemoveProject: (projectId: string) => void
	onArchiveSession: (sessionId: string) => void
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
	collapseSignal,
	onSelectSession,
	onNewSession,
	onRenameProject,
	onRemoveProject,
	onArchiveSession,
}: ProjectGroupProps) {
	const [collapsed, setCollapsed] = useState(false)

	// Sync local collapsed state when the global collapse signal changes.
	// Odd signal = collapsed, even signal = expanded.
	useEffect(() => {
		if (collapseSignal === 0) return
		setCollapsed(collapseSignal % 2 === 1)
	}, [collapseSignal])
	const [renaming, setRenaming] = useState(false)
	const inputRef = useRef<HTMLInputElement>(null)

	const handleRenameStart = useCallback(() => {
		setRenaming(true)
		// Wait for the input to render, then focus and select
		requestAnimationFrame(() => inputRef.current?.select())
	}, [])

	const handleRenameCommit = useCallback(
		(value: string) => {
			setRenaming(false)
			const trimmed = value.trim()
			if (trimmed && trimmed !== project.name) {
				onRenameProject(project.id, trimmed)
			}
		},
		[project.id, project.name, onRenameProject],
	)

	const handleRenameCancel = useCallback(() => {
		setRenaming(false)
	}, [])

	return (
		<div className="mb-1">
			<div className="group flex w-full items-center gap-1 px-3 py-0.5">
				<button
					type="button"
					className="flex flex-1 items-center gap-2 rounded-md px-1 py-1 text-left text-xs font-medium text-foreground transition-colors hover:text-foreground"
					onClick={() => setCollapsed(!collapsed)}
				>
					<Folder className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
					{renaming ? (
						<input
							ref={inputRef}
							type="text"
							defaultValue={project.name}
							className="min-w-0 flex-1 rounded border border-border bg-surface px-1 py-0.5 text-xs text-foreground outline-none focus:border-accent"
							onClick={(e) => e.stopPropagation()}
							onKeyDown={(e) => {
								e.stopPropagation()
								if (e.key === "Enter") {
									handleRenameCommit((e.target as HTMLInputElement).value)
								} else if (e.key === "Escape") {
									handleRenameCancel()
								}
							}}
							onBlur={(e) => handleRenameCommit(e.target.value)}
						/>
					) : (
						<span className="truncate">{project.name}</span>
					)}
				</button>
				<ProjectContextMenu
					onRename={handleRenameStart}
					onRemove={() => onRemoveProject(project.id)}
				/>
				<button
					type="button"
					className={cn(
						"shrink-0 rounded-md p-0.5 text-muted opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100",
					)}
					onClick={() => onNewSession(project.id)}
					title={`New thread in ${project.name}`}
					aria-label={`New thread in ${project.name}`}
				>
					<Plus className="h-3 w-3" aria-hidden="true" />
				</button>
			</div>
			<div
				className="grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)]"
				style={{
					gridTemplateRows: collapsed ? "0fr" : "1fr",
					opacity: collapsed ? 0 : 1,
				}}
			>
				<div className="min-h-0 overflow-hidden">
					<div className="mt-0.5 px-2">
						{sessions.length === 0 ? (
							<p className="px-3 py-1 text-xs text-muted">No threads</p>
						) : (
							sessions.map((s) => (
								<SessionItem
									key={s.id}
									session={s}
									status={sessionStatuses?.[s.id]}
									isActive={s.id === activeSessionId}
									onSelect={onSelectSession}
									onArchive={onArchiveSession}
								/>
							))
						)}
					</div>
				</div>
			</div>
		</div>
	)
}
