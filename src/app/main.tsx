import { RouterProvider } from "@tanstack/react-router"
import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { bootstrapGlobal, bootstrapWorkspace, loadAllProjectSessions } from "./bootstrap"
import { useSSERouter } from "./hooks/use-sse"
import { apiClient } from "./lib/api-client"
import {
	getLastDirectory,
	getLastProjectId,
	getLastSessionId,
	setLastDirectory,
	setLastProjectId,
	setLastSessionId,
} from "./lib/local-persistence"
import { router } from "./router"
import { useConfigStore } from "./stores/config-store"
import { useProjectStore } from "./stores/project-store"
import { useUIStore } from "./stores/ui-store"
import "./global.css"

/**
 * Restore the last project/session on launch.
 * Navigates away from "/" before the router renders the IndexPage.
 */
async function restoreLastState(): Promise<void> {
	const lastProjectId = getLastProjectId()
	const lastDirectory = getLastDirectory()
	const lastSessionId = getLastSessionId()

	const projects = useProjectStore.getState().projects

	// No projects → stay on "/", IndexPage shows "add project" prompt
	if (projects.length === 0) return

	// Find last project or fall back to first project
	let project = lastProjectId ? projects.find((p) => p.id === lastProjectId) : null
	let directory = project ? lastDirectory : null

	if (!project) {
		project = projects[0]
		directory = project.directory
		setLastProjectId(project.id)
		setLastDirectory(directory)
		setLastSessionId(null)
	}

	// Set UI store state (also persists to localStorage)
	useUIStore.getState().setActiveProject(project.id)
	useUIStore.getState().setActiveDirectory(directory!)

	// Try to restore last session
	if (lastSessionId && directory) {
		try {
			await bootstrapWorkspace(directory)
			const session = await apiClient.get(`/sessions/${lastSessionId}`)
			if (session) {
				useUIStore.getState().setActiveSession(lastSessionId)
				router.navigate({
					to: "/workspace/$dir/session/$id",
					params: { dir: encodeURIComponent(directory), id: lastSessionId },
					replace: true,
				})
				return
			}
		} catch {
			setLastSessionId(null)
		}
	}

	// No session to restore — navigate to workspace (new session mode)
	router.navigate({
		to: "/workspace/$dir",
		params: { dir: encodeURIComponent(directory!) },
		replace: true,
	})
}

function App() {
	const [ready, setReady] = useState(false)
	const [error, setError] = useState<Error | null>(null)

	useSSERouter()

	useEffect(() => {
		bootstrapGlobal()
			.then(() => {
				// Apply theme from config before rendering
				const { theme } = useConfigStore.getState().config
				document.documentElement.classList.toggle("dark", theme === "dark")
				document.documentElement.classList.toggle("light", theme === "light")
				document.documentElement.setAttribute("data-theme", theme)
			})
			.then(() => restoreLastState())
			.then(() => {
				setReady(true)
				// Fire-and-forget: eagerly load sessions for all projects
				// so the sidebar is fully populated.
				const activeDir = useUIStore.getState().activeDirectory
				loadAllProjectSessions(activeDir ?? undefined)
			})
			.catch(setError)
	}, [])

	if (error) {
		return (
			<div className="flex h-screen items-center justify-center bg-background text-error">
				<div className="text-center">
					<h1 className="text-xl font-bold">Failed to connect</h1>
					<p className="mt-2 text-muted">{error.message}</p>
				</div>
			</div>
		)
	}

	if (!ready) {
		return (
			<div className="flex h-screen items-center justify-center bg-background text-foreground">
				<div className="text-center">
					<div className="mb-4 text-2xl">Loop</div>
					<div className="text-muted">Starting server...</div>
				</div>
			</div>
		)
	}

	return <RouterProvider router={router} />
}

const root = document.getElementById("root")!
createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
)
