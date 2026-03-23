import { FolderOpen } from "@openai/apps-sdk-ui/components/Icon"
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
						<FolderOpen className="h-4 w-4" aria-hidden="true" />
						Open Project
					</button>
				</div>
			</div>
		)
	}

	return null
}
