import { RouterProvider } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import logoUrl from "./assets/icons/logo.png"
import {
	bootstrapGlobal,
	bootstrapWorkspace,
	loadAllProjectSessions,
	loadWorktreeSessions,
} from "./bootstrap"
import { ErrorBoundary } from "./components/error-boundary"
import { useSSERouter } from "./hooks/use-sse"
import type { PopoutContext } from "./lib/desktop-bridge"
import { getDraft } from "./lib/draft-session"
import {
	getLastDirectory,
	getLastProjectId,
	getLastSessionId,
	setLastDirectory,
	setLastProjectId,
	setLastSessionId,
} from "./lib/local-persistence"
import { getPopoutContext, isPopoutWindow } from "./lib/popout"
import { SessionNotFoundError, ensureSession } from "./lib/session-loader"
import { initThemeEngine } from "./lib/theme-engine"
import { router } from "./router"
import { useConfigStore } from "./stores/config-store"
import { useProjectStore } from "./stores/project-store"
import { useUIStore } from "./stores/ui-store"
import { workspaceStoreRegistry } from "./stores/workspace-store"
import { useWorktreeStore } from "./stores/worktree-store"
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
		// Draft fast-path: a not-yet-POSTed session whose id was persisted as
		// `lastSessionId` before refresh. No fetch needed — `useActiveSession`
		// will synthesize the session from the draft.
		if (getDraft(lastSessionId)) {
			useUIStore.getState().setActiveSession(lastSessionId)
			router.navigate({
				to: "/workspace/$dir/session/$id",
				params: { dir: encodeURIComponent(directory), id: lastSessionId },
				replace: true,
			})
			return
		}
		try {
			await bootstrapWorkspace(directory)
			const store = workspaceStoreRegistry.getOrCreate(directory)
			await ensureSession(store, lastSessionId, directory)
			useUIStore.getState().setActiveSession(lastSessionId)
			router.navigate({
				to: "/workspace/$dir/session/$id",
				params: { dir: encodeURIComponent(directory), id: lastSessionId },
				replace: true,
			})
			return
		} catch (err) {
			if (err instanceof SessionNotFoundError) setLastSessionId(null)
			// Other errors: fall through to /workspace/$dir below; the user can
			// retry from the sidebar once the network recovers.
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
		let unsubWorktrees: (() => void) | undefined

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

					// Worktree metadata arrives asynchronously from bootstrapWorkspace.
					// Subscribe so that when new worktrees appear, their sessions load
					// automatically (closing the race where loadAllProjectSessions runs
					// before worktree data is available).
					let prevWorktreeSize = useWorktreeStore.getState().worktrees.size
					unsubWorktrees = useWorktreeStore.subscribe((state) => {
						if (state.worktrees.size > prevWorktreeSize) {
							prevWorktreeSize = state.worktrees.size
							loadWorktreeSessions(activeDir ?? undefined)
						}
					})
				}
			})
			.catch(setError)

		return () => unsubWorktrees?.()
	}, [])

	if (error) {
		return (
			<div
				data-loading
				className="flex h-screen items-center justify-center bg-background text-error"
			>
				<div className="text-center">
					<h1 className="text-xl font-bold">Failed to connect</h1>
					<p className="mt-2 text-muted">{error.message}</p>
				</div>
			</div>
		)
	}

	if (!ready) {
		return (
			<div
				data-loading
				className="flex h-screen items-center justify-center bg-background text-foreground"
			>
				<img src={logoUrl} alt="Loop" className="w-72 dark:invert" />
			</div>
		)
	}

	return <RouterProvider router={router} />
}

const root = document.getElementById("root")!
createRoot(root).render(
	// <StrictMode>
	<ErrorBoundary>
		<App />
	</ErrorBoundary>,
	// </StrictMode>,
)
