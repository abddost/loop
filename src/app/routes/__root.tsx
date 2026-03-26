import type { Project } from "@core/schema"
import { Outlet, useNavigate } from "@tanstack/react-router"
import { useCallback, useEffect } from "react"
import { AppShell } from "../components/layout/app-shell"
import { Sidebar } from "../components/layout/sidebar/sidebar"
import { useAllProjectSessions, useAllSessionStatuses } from "../hooks/use-all-sessions"
import { useCreateProject } from "../hooks/use-create-project"
import { apiClient } from "../lib/api-client"
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

	// Subscribe to sessions and statuses from ALL workspace stores
	const sessionsByProject = useAllProjectSessions()
	const sessionStatuses = useAllSessionStatuses()

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

	const handleRenameProject = useCallback((projectId: string, newName: string) => {
		useProjectStore.getState().updateProject(projectId, { name: newName })
		apiClient.patch(`/projects/${projectId}`, { name: newName }).catch((err) => {
			console.error("[root:rename-project]", err)
			// Revert: re-fetch from server
			apiClient
				.get<any[]>("/projects")
				.then((projects) => useProjectStore.getState().init(projects))
				.catch(() => {})
		})
	}, [])

	const handleRemoveProject = useCallback(
		(projectId: string) => {
			const project = useProjectStore.getState().projects.find((p) => p.id === projectId)
			if (!project) return

			// Navigate away if this is the active project
			const ui = useUIStore.getState()
			if (ui.activeDirectory === project.directory) {
				const remaining = useProjectStore.getState().projects.filter((p) => p.id !== projectId)
				if (remaining.length > 0) {
					const next = remaining[0]
					ui.setActiveDirectory(next.directory)
					ui.setActiveSession(null)
					navigate({
						to: "/workspace/$dir",
						params: { dir: encodeURIComponent(next.directory) },
					})
				} else {
					ui.setActiveDirectory(null)
					ui.setActiveSession(null)
					navigate({ to: "/" })
				}
			}

			useProjectStore.getState().removeProject(projectId)
			apiClient.del(`/projects/${projectId}`).catch((err) => {
				console.error("[root:remove-project]", err)
				apiClient
					.get<any[]>("/projects")
					.then((projects) => useProjectStore.getState().init(projects))
					.catch(() => {})
			})
		},
		[navigate],
	)

	const handleArchiveSession = useCallback(
		(sessionId: string) => {
			// Find which workspace store owns this session
			let targetDir: string | null = null
			for (const p of useProjectStore.getState().projects) {
				const store = workspaceStoreRegistry.get(p.directory)
				if (store?.getState().sessions.some((s) => s.id === sessionId)) {
					targetDir = p.directory
					break
				}
			}
			if (!targetDir) return

			// Navigate away if this is the active session
			const ui = useUIStore.getState()
			if (ui.activeSessionId === sessionId) {
				ui.setActiveSession(null)
				navigate({
					to: "/workspace/$dir",
					params: { dir: encodeURIComponent(targetDir) },
				})
			}

			// Optimistic removal from sidebar
			const store = workspaceStoreRegistry.get(targetDir)
			store?.getState().removeSession(sessionId)

			apiClient
				.patch(`/sessions/${sessionId}`, { archivedAt: Date.now() }, { directory: targetDir })
				.catch((err) => console.error("[root:archive-session]", err))
		},
		[navigate],
	)

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
					sessionStatuses={sessionStatuses}
					activeSessionId={activeSessionId ?? undefined}
					onSelectSession={handleSelectSession}
					onNewSession={handleNewSession}
					onNewProject={handleNewProject}
					onOpenSettings={handleOpenSettings}
					onRenameProject={handleRenameProject}
					onRemoveProject={handleRemoveProject}
					onArchiveSession={handleArchiveSession}
				/>
			}
		>
			<Outlet />
		</AppShell>
	)
}
