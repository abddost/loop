import { useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { useCreateProject } from "../hooks/use-create-project"
import { getLastDirectory } from "../lib/local-persistence"
import { useProjectStore } from "../stores/project-store"
import { useUIStore } from "../stores/ui-store"

/**
 * Index page at "/". Redirects to the last workspace if one exists,
 * otherwise shows a fallback "add project" prompt.
 *
 * This handles both initial load (restore-on-launch in main.tsx may
 * have already navigated away) and returning to "/" from other routes
 * (e.g. browser back from settings).
 */
export function IndexPage() {
	const navigate = useNavigate()
	const projects = useProjectStore((s) => s.projects)
	const { createProject, loading } = useCreateProject()

	useEffect(() => {
		if (projects.length === 0) return

		// Try last directory from localStorage or UI store
		const dir = useUIStore.getState().activeDirectory ?? getLastDirectory()
		if (dir) {
			const activeSessionId = useUIStore.getState().activeSessionId
			if (activeSessionId) {
				navigate({
					to: "/workspace/$dir/session/$id",
					params: { dir: encodeURIComponent(dir), id: activeSessionId },
					replace: true,
				})
			} else {
				navigate({
					to: "/workspace/$dir",
					params: { dir: encodeURIComponent(dir) },
					replace: true,
				})
			}
			return
		}

		// No last directory — use first project
		const first = projects[0]
		navigate({
			to: "/workspace/$dir",
			params: { dir: encodeURIComponent(first.directory) },
			replace: true,
		})
	}, [projects, navigate])

	// Only shown briefly during redirect, or if no projects exist
	if (projects.length === 0) {
		return (
			<div className="flex h-full items-center justify-center">
				<div className="text-center">
					<h1 className="text-xl font-semibold text-foreground">Welcome to Loop</h1>
					<p className="mt-2 text-sm text-muted">Add a project to get started.</p>
					<button
						type="button"
						onClick={createProject}
						disabled={loading}
						className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
					>
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
							aria-hidden="true"
						>
							<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
							<line x1="12" y1="11" x2="12" y2="17" />
							<line x1="9" y1="14" x2="15" y2="14" />
						</svg>
						Open Project
					</button>
				</div>
			</div>
		)
	}

	return null
}
