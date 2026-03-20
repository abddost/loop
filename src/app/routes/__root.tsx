import type { Project } from "@core/schema"
import { Outlet, useNavigate } from "@tanstack/react-router"
import { useCallback, useEffect } from "react"
import { AppShell } from "../components/layout/app-shell"
import { Sidebar } from "../components/layout/sidebar/sidebar"
import { useAllProjectSessions } from "../hooks/use-all-sessions"
import { useCreateProject } from "../hooks/use-create-project"
import { isPopoutWindow } from "../lib/popout"
import { useProjectStore } from "../stores/project-store"
import { useUIStore } from "../stores/ui-store"
import { workspaceStoreRegistry } from "../stores/workspace-store"

/**
 * Root layout wrapping all routes with the AppShell and Sidebar.
 * In popout mode, renders a bare full-width shell (no sidebar).
 */
export function RootLayout() {
	const navigate = useNavigate()

	// ── Popout mode: skip sidebar entirely ──
	if (isPopoutWindow()) {
		return (
			<div className="flex h-screen w-screen overflow-hidden bg-background">
				<main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
					<Outlet />
				</main>
			</div>
		)
	}

	return <MainLayout navigate={navigate} />
}

/**
 * Main window layout with sidebar, session management, and menu actions.
 * Extracted so popout mode can bail out early without running hooks.
 */
function MainLayout({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
	const projects = useProjectStore((s) => s.projects)
	const activeSessionId = useUIStore((s) => s.activeSessionId)
	const { createProject: handleNewProject } = useCreateProject()

	// Subscribe to sessions from ALL workspace stores so the sidebar
	// re-renders when any project's sessions change
	const sessionsByProject = useAllProjectSessions()

	const handleSelectSession = useCallback(
		(sessionId: string) => {
			// Find which project owns this session to get the correct directory
			let targetDir: string | null = null
			for (const p of useProjectStore.getState().projects) {
				const store = workspaceStoreRegistry.get(p.directory)
				if (store?.getState().sessions.some((s) => s.id === sessionId)) {
					targetDir = p.directory
					break
				}
			}
			// Fall back to active directory if session not found in any store
			targetDir = targetDir ?? useUIStore.getState().activeDirectory
			if (!targetDir) return

			useUIStore.getState().setActiveDirectory(targetDir)
			useUIStore.getState().setActiveSession(sessionId)
			navigate({
				to: "/workspace/$dir/session/$id",
				params: { dir: encodeURIComponent(targetDir), id: sessionId },
			})
		},
		[navigate],
	)

	const handleNewSession = useCallback(
		(projectId: string) => {
			const project = useProjectStore.getState().projects.find((p) => p.id === projectId)
			if (!project) return
			useUIStore.getState().setActiveProject(projectId)
			useUIStore.getState().setActiveDirectory(project.directory)
			useUIStore.getState().setActiveSession(null)
			navigate({
				to: "/workspace/$dir",
				params: { dir: encodeURIComponent(project.directory) },
			})
		},
		[navigate],
	)

	const handleOpenSettings = useCallback(() => {
		navigate({ to: "/settings" })
	}, [navigate])

	// Listen for menu actions from the Electron main process (e.g. Settings Cmd+,)
	useEffect(() => {
		if (!window.desktopBridge?.onMenuAction) return
		const unsubscribe = window.desktopBridge.onMenuAction((action) => {
			if (action === "open-settings") {
				navigate({ to: "/settings" })
			}
		})
		return unsubscribe
	}, [navigate])

	// Listen for "navigate to session" from popout "Return to Main" action
	useEffect(() => {
		if (!window.desktopBridge?.onNavigateToSession) return
		const unsubscribe = window.desktopBridge.onNavigateToSession((sessionId) => {
			// Find which project owns this session
			let targetDir: string | null = null
			for (const p of useProjectStore.getState().projects) {
				const store = workspaceStoreRegistry.get(p.directory)
				if (store?.getState().sessions.some((s) => s.id === sessionId)) {
					targetDir = p.directory
					break
				}
			}
			targetDir = targetDir ?? useUIStore.getState().activeDirectory
			if (!targetDir) return

			useUIStore.getState().setActiveDirectory(targetDir)
			useUIStore.getState().setActiveSession(sessionId)
			navigate({
				to: "/workspace/$dir/session/$id",
				params: { dir: encodeURIComponent(targetDir), id: sessionId },
			})
		})
		return unsubscribe
	}, [navigate])

	return (
		<AppShell
			sidebar={
				<Sidebar
					projects={projects as unknown as Project[]}
					sessionsByProject={sessionsByProject as any}
					activeSessionId={activeSessionId ?? undefined}
					onSelectSession={handleSelectSession}
					onNewSession={handleNewSession}
					onNewProject={handleNewProject}
					onOpenSettings={handleOpenSettings}
				/>
			}
		>
			<Outlet />
		</AppShell>
	)
}
