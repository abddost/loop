import type { Project } from "@core/schema"
import { Check, ChevronDown, Folder, Plus } from "@openai/apps-sdk-ui/components/Icon"
import { useEffect, useRef, useState } from "react"
import { cn } from "../ui/cn"

export interface ProjectSelectorProps {
	projects: Project[]
	selectedProjectId: string | null
	onSelect: (projectId: string) => void
	onNewProject?: () => void
}

export function ProjectSelector({
	projects,
	selectedProjectId,
	onSelect,
	onNewProject,
}: ProjectSelectorProps) {
	const [open, setOpen] = useState(false)
	const ref = useRef<HTMLDivElement>(null)
	const selectedProject = projects.find((p) => p.id === selectedProjectId)

	useEffect(() => {
		if (!open) return
		const handler = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
		}
		document.addEventListener("mousedown", handler)
		return () => document.removeEventListener("mousedown", handler)
	}, [open])

	return (
		<div className="relative" ref={ref}>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className={cn(
					"el-surface-hover flex items-center gap-1.5 px-1.5 py-0.5 text-xs text-muted transition-all hover:text-foreground",
					open && "bg-[var(--app-surface-hover)] text-foreground",
				)}
			>
				<Folder className="h-3 w-3 shrink-0" aria-hidden="true" />
				<span className="max-w-[140px] truncate">{selectedProject?.name ?? "Select project"}</span>
				<ChevronDown
					className={cn("h-2.5 w-2.5 transition-transform", open && "rotate-180")}
					aria-hidden="true"
				/>
			</button>

			{open && (
				<div
					className={cn(
						"absolute bottom-full left-0 z-50 mb-1 w-[220px] overflow-hidden rounded-xl",
						"el-dropdown shadow-[var(--shadow-dropdown)]",
						"animate-in fade-in slide-in-from-bottom-2 duration-150",
					)}
				>
					<div className="max-h-[280px] overflow-y-auto py-1">
						{projects.map((p) => (
							<button
								key={p.id}
								type="button"
								onClick={() => {
									onSelect(p.id)
									setOpen(false)
								}}
								className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-overlay-foreground transition-colors hover:bg-surface-hover"
							>
								<Folder className="h-3 w-3 shrink-0 text-muted" aria-hidden="true" />
								<span className="flex-1 truncate">{p.name}</span>
								{p.id === selectedProjectId && (
									<Check className="h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
								)}
							</button>
						))}
					</div>
					{onNewProject && (
						<>
							<div className="border-t border-border/20" />
							<button
								type="button"
								onClick={() => {
									onNewProject()
									setOpen(false)
								}}
								className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-accent/80 transition-colors hover:bg-surface-hover hover:text-accent"
							>
								<Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
								<span>Add new project</span>
							</button>
						</>
					)}
				</div>
			)}
		</div>
	)
}
