import type { Project } from "@core/schema"
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { useCallback, useEffect } from "react"
import { TaskPanel } from "../components/chat/task-panel"
import { FilePanel } from "../components/file-panel/file-panel"
import { AppShell } from "../components/layout/app-shell"
import { Sidebar } from "../components/layout/sidebar/sidebar"
import { QuickOpenModal } from "../components/quick-open/quick-open-modal"
import { SnackbarContainer } from "../components/ui/snackbar"
import { useAllProjectSessions, useAllSessionStatuses } from "../hooks/use-all-sessions"
import { useCreateProject } from "../hooks/use-create-project"
import { useRegisterCommand } from "../hooks/use-keybinding"
import { apiClient } from "../lib/api-client"
import { createDraft } from "../lib/draft-session"
import { isPopoutWindow } from "../lib/popout"
import { ensureSession } from "../lib/session-loader"
import { useProjectStore } from "../stores/project-store"
import { useQuickOpenStore } from "../stores/quick-open-store"
import { useUIStore } from "../stores/ui-store"
import { workspaceStoreRegistry } from "../stores/workspace-store"
import { useWorktreeStore } from "../stores/worktree-store"
import { SettingsPage } from "./settings-page"

/**
 * Root layout wrapping all routes with the AppShell and Sidebar.
 * In popout mode, renders a bare full-width shell (no sidebar).
 */
export function RootLayout() {
	const navigate = useNavigate()

	// ── Popout mode: skip sidebar entirely ──
	if (isPopoutWindow()) {
		return (
			<div data-shell className="flex h-screen w-screen overflow-hidden bg-background">
				<main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
					<Outlet />
				</main>
				<SnackbarContainer />
			</div>
		)
	}

	return <MainLayout navigate={navigate} />
}

/**
 * Main window layout with sidebar, session management, and menu actions.
 * Extracted so popout mode can bail out early without running hooks.
 *
 * Settings is rendered as a fixed overlay on top of AppShell so that
 * AppShell (and all its subscriptions / resize state) never unmounts —
 * this eliminates the freeze that occurred when conditionally skipping
 * the entire layout on the /settings route.
 */
function MainLayout({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
	const pathname = useRouterState({ select: (s) => s.location.pathname })
	const isSettings = pathname === "/settings"

	const projects = useProjectStore((s) => s.projects)
	const activeSessionId = useUIStore((s) => s.activeSessionId)
	const activeProjectId = useUIStore((s) => s.activeProjectId)
	const { createProject: handleNewProject } = useCreateProject()

	// Subscribe to sessions and statuses from ALL workspace stores
	const sessionsByProject = useAllProjectSessions()
	const sessionStatuses = useAllSessionStatuses()

	/**
	 * Shared navigation logic for opening a session.
	 * Resolves the parent project (handling both project and worktree directories),
	 * sets UI state, and navigates to the session route.
	 */
	const navigateToSession = useCallback(
		(sessionId: string, directory: string) => {
			// Resolve parent project: if directory is a worktree, use its parentDirectory
			const worktrees = useWorktreeStore.getState().worktrees
			const wt = worktrees.get(directory)
			const projectDir = wt?.parentDirectory ?? directory
			const project = useProjectStore.getState().projects.find((p) => p.directory === projectDir)

			if (project) useUIStore.getState().setActiveProject(project.id)
			useUIStore.getState().setActiveDirectory(directory)
			useUIStore.getState().setActiveSession(sessionId)

			// Pre-warm the session loader so the fetch is in-flight by the time
			// SessionPage's effect runs. The dedupe Map ensures only one underlying
			// fetch executes regardless of duplicate triggers.
			const targetStore = workspaceStoreRegistry.getOrCreate(directory)
			void ensureSession(targetStore, sessionId, directory).catch(() => {
				// SessionPage's effect handles errors (404 redirect, retries).
			})

			navigate({
				to: "/workspace/$dir/session/$id",
				params: { dir: encodeURIComponent(directory), id: sessionId },
			})
		},
		[navigate],
	)

	const handleNewSession = useCallback(
		(projectId: string) => {
			const project = useProjectStore.getState().projects.find((p) => p.id === projectId)
			if (!project) return
			// Generate a client-side ULID and persist it as a draft. The session
			// route renders the welcome view (via the draft fallback in
			// `useActiveSession` + `isNewSession` recomputation) without a server
			// round-trip; the first message commits the draft via POST /sessions.
			const draft = createDraft(project.directory)
			useUIStore.getState().setActiveProject(projectId)
			useUIStore.getState().setActiveDirectory(project.directory)
			useUIStore.getState().setActiveSession(draft.id)
			navigate({
				to: "/workspace/$dir/session/$id",
				params: { dir: encodeURIComponent(project.directory), id: draft.id },
			})
		},
		[navigate],
	)

	const handleOpenSettings = useCallback(() => {
		navigate({ to: "/settings" })
	}, [navigate])

	// ── Global keybinding commands ──
	useRegisterCommand({
		id: "sidebar.toggle",
		handler: () => useUIStore.getState().toggleSidebar(),
	})
	useRegisterCommand({
		id: "session.new",
		handler: () => {
			const activeDir = useUIStore.getState().activeDirectory
			const project = useProjectStore.getState().projects.find((p) => p.directory === activeDir)
			if (project) handleNewSession(project.id)
		},
	})
	useRegisterCommand({
		id: "settings.open",
		handler: handleOpenSettings,
	})
	useRegisterCommand({
		id: "quickOpen.open",
		handler: () => useQuickOpenStore.getState().openModal(),
	})

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

	const handleRenameSession = useCallback(
		(sessionId: string, directory: string, newTitle: string) => {
			const store = workspaceStoreRegistry.get(directory)
			store?.getState().updateSession(sessionId, { title: newTitle })
			apiClient
				.patch(`/sessions/${sessionId}`, { title: newTitle }, { directory })
				.catch((err) => console.error("[root:rename-session]", err))
		},
		[],
	)

	const handleArchiveSession = useCallback(
		(sessionId: string, directory: string) => {
			// Navigate away if this is the active session
			const ui = useUIStore.getState()
			if (ui.activeSessionId === sessionId) {
				// Navigate to the parent project directory (not worktree) for new session view
				const worktrees = useWorktreeStore.getState().worktrees
				const wt = worktrees.get(directory)
				const navDir = wt?.parentDirectory ?? directory
				ui.setActiveSession(null)
				navigate({
					to: "/workspace/$dir",
					params: { dir: encodeURIComponent(navDir) },
				})
			}

			// Optimistic removal from sidebar
			const store = workspaceStoreRegistry.get(directory)
			store?.getState().removeSession(sessionId)

			apiClient
				.patch(`/sessions/${sessionId}`, { archivedAt: Date.now() }, { directory })
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
		const unsubscribe = window.desktopBridge.onNavigateToSession((sessionId, directory) => {
			navigateToSession(sessionId, directory)
		})
		return unsubscribe
	}, [navigateToSession])

	return (
		<>
			<AppShell
				className={isSettings ? "invisible" : undefined}
				sidebar={
					<Sidebar
						projects={projects as unknown as Project[]}
						sessionsByProject={sessionsByProject as any}
						sessionStatuses={sessionStatuses}
						activeSessionId={activeSessionId ?? undefined}
						activeProjectId={activeProjectId}
						onSelectSession={navigateToSession}
						onNewSession={handleNewSession}
						onNewProject={handleNewProject}
						onOpenSettings={handleOpenSettings}
						onRenameProject={handleRenameProject}
						onRemoveProject={handleRemoveProject}
						onArchiveSession={handleArchiveSession}
						onRenameSession={handleRenameSession}
					/>
				}
				rightPanel={<FilePanel />}
				taskPanel={<TaskPanel />}
			>
				<Outlet />
			</AppShell>
			{/* Settings overlay — fixed on top so AppShell stays mounted (no jank).
			    Instant snap on enter & exit (symmetric, like a native tab swap).
			    AppShell goes `invisible` while open so its translucent surfaces
			    don't bleed through the settings overlay in glass mode. */}
			{isSettings && (
				<div data-shell className="fixed inset-0 z-50 flex overflow-hidden bg-surface">
					<SettingsPage />
				</div>
			)}
			<QuickOpenModal />
			<SnackbarContainer />
		</>
	)
}
