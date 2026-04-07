import { RouterProvider } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import logoUrl from "./assets/icons/logo.png"
import { bootstrapGlobal, bootstrapWorkspace, loadAllProjectSessions } from "./bootstrap"
import { useSSERouter } from "./hooks/use-sse"
import { apiClient } from "./lib/api-client"
import type { PopoutContext } from "./lib/desktop-bridge"
import {
	getLastDirectory,
	getLastProjectId,
	getLastSessionId,
	setLastDirectory,
	setLastProjectId,
	setLastSessionId,
} from "./lib/local-persistence"
import { getPopoutContext, isPopoutWindow } from "./lib/popout"
import { initThemeEngine } from "./lib/theme-engine"
import { router } from "./router"
import { useConfigStore } from "./stores/config-store"
import { useProjectStore } from "./stores/project-store"
import { useUIStore } from "./stores/ui-store"
import "./global.css"

// ── Bootstrap helpers ────────────────────────────────────────────────────

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

/**
 * Bootstrap a popout window: navigate directly to the target route.
 * Skips restoreLastState and sidebar population.
 */
async function bootstrapPopout(ctx: PopoutContext): Promise<void> {
	await bootstrapWorkspace(ctx.directory)
	useUIStore.getState().setActiveDirectory(ctx.directory)

	if (ctx.type === "file-panel") {
		router.navigate({
			to: "/popout/$dir/file-panel",
			params: { dir: encodeURIComponent(ctx.directory) },
			replace: true,
		})
	} else {
		useUIStore.getState().setActiveSession(ctx.sessionId)
		router.navigate({
			to: "/workspace/$dir/session/$id",
			params: { dir: encodeURIComponent(ctx.directory), id: ctx.sessionId },
			replace: true,
		})
	}
}

// Module-level — runs ONCE at import time, immune to StrictMode double-mount.
// The useEffect inside App just .then()s on the same in-flight/resolved promise.
const bootstrapReady = bootstrapGlobal()

function App() {
	const [ready, setReady] = useState(false)
	const [error, setError] = useState<Error | null>(null)

	useSSERouter()

	useEffect(() => {
		bootstrapReady
			.then(() => {
				// Apply appearance (theme, fonts, sidebar) from config before rendering
				initThemeEngine(useConfigStore.getState().config.appearance)
			})
			.then(() => {
				const popoutCtx = getPopoutContext()
				if (popoutCtx) {
					return bootstrapPopout(popoutCtx)
				}
				return restoreLastState()
			})
			.then(() => {
				setReady(true)
				// Fire-and-forget: eagerly load sessions for all projects
				// so the sidebar is fully populated (skip in popout windows).
				if (!isPopoutWindow()) {
					const activeDir = useUIStore.getState().activeDirectory
					loadAllProjectSessions(activeDir ?? undefined)
				}
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
				<div className="flex flex-col items-center gap-1.5">
					<img src={logoUrl} alt="Loop" className="w-20 dark:invert-0 invert" />
					<div className="text-2xl font-extrabold tracking-[0.2em]">Loop</div>
				</div>
			</div>
		)
	}

	return <RouterProvider router={router} />
}

const root = document.getElementById("root")!
createRoot(root).render(
	// <StrictMode>
	<App />,
	// </StrictMode>,
)
