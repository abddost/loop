import type { AppConfig } from "@core/schema/config"
import { DEFAULT_CONFIG } from "@core/schema/config"
import type { EditorInfo } from "@core/schema/editor"
import type { McpServerInfo } from "@core/schema/mcp"
import type { Sandbox } from "@core/schema/sandbox"
import type { SessionStatus } from "@core/schema/session"
import { apiClient } from "./lib/api-client"
import { desktopBridge } from "./lib/desktop-bridge"
import { preloadProviderLogos } from "./lib/provider-logos"
import { sseClient } from "./lib/sse-client"
import { worktreeApi } from "./lib/worktree-api"
import { useAgentStore } from "./stores/agent-store"
import { useConfigStore } from "./stores/config-store"
import { useEditorStore } from "./stores/editor-store"
import { useMcpStore } from "./stores/mcp-store"
import { useProjectStore } from "./stores/project-store"
import { useProviderStore } from "./stores/provider-store"
import { useTerminalStore } from "./stores/terminal-store"
import { workspaceStoreRegistry } from "./stores/workspace-store"
import { useWorktreeStore } from "./stores/worktree-store"

/**
 * Health poll: retry GET /health until server is ready.
 */
async function healthPoll(
	url: string,
	opts: { maxAttempts: number; intervalMs: number },
): Promise<void> {
	for (let i = 0; i < opts.maxAttempts; i++) {
		try {
			const res = await fetch(`${url}/health`)
			if (res.ok) return
		} catch {
			// Server not ready yet
		}
		await new Promise((r) => setTimeout(r, opts.intervalMs))
	}
	throw new Error("Server health check failed after max attempts")
}

/**
 * Wave 1: Global bootstrap. Blocking -- UI shows after this completes.
 * - Get server info from Tauri
 * - Health poll until server responds
 * - Initialize API client
 * - Load providers and projects
 */
export async function bootstrapGlobal(): Promise<void> {
	const { url, token } = await desktopBridge.getServerInfo()
	await healthPoll(url, { maxAttempts: 30, intervalMs: 200 })

	apiClient.init(url, token)
	sseClient.init(url, token)
	// Establish SSE connection immediately — don't wait for workspace navigation.
	// Events are multiplexed across all workspaces on a single connection.
	sseClient.ensureConnected()
	useTerminalStore.getState().init(url, token)

	const [providerData, projects, agents, config, editors] = await Promise.all([
		apiClient.get<{
			connected: any[]
			popular: any[]
			other: any[]
		}>("/providers"),
		apiClient.get<any[]>("/projects"),
		apiClient.get<any[]>("/agents").catch((err) => {
			console.error("[bootstrap:agents]", err)
			return []
		}),
		apiClient.get<AppConfig>("/config").catch((err) => {
			console.error("[bootstrap:config]", err)
			return DEFAULT_CONFIG
		}),
		apiClient.get<EditorInfo[]>("/editors").catch((err) => {
			console.error("[bootstrap:editors]", err)
			return [] as EditorInfo[]
		}),
	])

	useConfigStore.getState().init(config)
	useProviderStore.getState().init(providerData, config.defaultModel, config.reasoning?.effort)
	useProjectStore.getState().init(projects)
	useAgentStore.getState().init(agents, config.defaultAgent)
	useEditorStore.getState().init(editors)

	// Preload provider logos in background (non-blocking)
	const allProviderIds = [
		...providerData.connected,
		...providerData.popular,
		...providerData.other,
	].map((p: { id: string }) => p.id)
	preloadProviderLogos(allProviderIds)
}

/**
 * Wave 2: Workspace bootstrap. Called when navigating to a workspace.
 * Idempotent — concurrent/repeated calls for the same directory reuse
 * the in-flight promise. Failed attempts are evicted so retries work.
 */
const wsCache = new Map<string, Promise<void>>()

export function bootstrapWorkspace(directory: string): Promise<void> {
	const existing = wsCache.get(directory)
	if (existing) return existing

	const promise = doBootstrapWorkspace(directory)
	wsCache.set(directory, promise)
	promise.catch(() => wsCache.delete(directory))
	return promise
}

async function doBootstrapWorkspace(directory: string): Promise<void> {
	// Step 1: Blocking -- triggers server-side WorkspaceBootstrap.
	// The server resolves the project even for worktree directories
	// (via sandbox lookup / git identity). Capture it so we always
	// use the canonical project directory for worktree parentDirectory.
	const project = await apiClient.get<{ directory: string }>("/project/current", { directory })
	const projectDirectory = project.directory

	// Step 2: Non-blocking -- UI renders immediately
	apiClient.setWorkspaceDirectory(directory)
	const store = workspaceStoreRegistry.getOrCreate(directory)

	Promise.all([
		apiClient.get("/sessions", { directory }).then((sessions) => {
			store.getState().initSessions(sessions as any[])
		}),
		apiClient
			.get<Record<string, SessionStatus>>("/sessions/status", { directory })
			.then((statuses) => {
				const state = store.getState()
				for (const [sid, status] of Object.entries(statuses)) {
					state.setSessionStatus(sid, status)
				}
				// Reset sessions that finished while we were disconnected —
				// /sessions/status only returns non-idle sessions, so any
				// session still marked busy on the client but absent from the
				// response has already gone idle on the server.
				state.reconcileSessionStatuses(statuses)
			}),
		apiClient.get("/vcs/branch", { directory }).then((branch) => {
			store.getState().initVcs(branch as any)
		}),
		apiClient
			.get<McpServerInfo[]>("/mcp/servers", { directory })
			.then((servers) => useMcpStore.getState().init(servers))
			.catch((err) => console.error("[bootstrap:mcp]", err)),
		worktreeApi
			.list(directory)
			.then((sandboxes) => {
				useWorktreeStore.getState().initWorktrees(
					projectDirectory,
					sandboxes.map((s: Sandbox) => ({
						id: s.id,
						directory: s.directory,
						parentDirectory: projectDirectory,
						name: s.name,
						branch: s.branch,
						status: s.status,
						createdAt: s.createdAt,
					})),
				)
			})
			.catch((err) => console.error("[bootstrap:worktrees]", err)),
	]).catch((err) => console.error("[bootstrap:workspace]", err))
}

/**
 * Re-bootstrap a workspace. Used on SSE reconnect to recover missed state.
 * Clears the bootstrap cache so the full flow re-runs.
 */
export function refreshWorkspace(directory: string): Promise<void> {
	wsCache.delete(directory)
	return bootstrapWorkspace(directory)
}

/**
 * Wave 3: Eager session loading for all projects.
 * Non-blocking — fires in background after the UI is ready.
 * Loads sessions for every project that doesn't already have them,
 * so the sidebar shows all sessions immediately.
 *
 * Each project is loaded independently — one failure doesn't block others.
 */
export function loadAllProjectSessions(excludeDirectory?: string): void {
	const projects = useProjectStore.getState().projects

	for (const project of projects) {
		// Skip the active workspace — already loaded by bootstrapWorkspace
		if (project.directory === excludeDirectory) continue

		const existing = workspaceStoreRegistry.get(project.directory)
		if (existing && existing.getState().sessions.length > 0) continue

		const store = workspaceStoreRegistry.getOrCreate(project.directory)
		Promise.all([
			apiClient.get<any[]>("/sessions", { directory: project.directory }).then((sessions) => {
				store.getState().initSessions(sessions)
			}),
			apiClient
				.get<Record<string, SessionStatus>>("/sessions/status", { directory: project.directory })
				.then((statuses) => {
					const state = store.getState()
					for (const [sid, status] of Object.entries(statuses)) {
						state.setSessionStatus(sid, status)
					}
					state.reconcileSessionStatuses(statuses)
				}),
		]).catch((err) => {
			console.error(`[bootstrap:sessions] ${project.name}:`, err)
		})
	}

	// Also load sessions from ready worktree workspaces
	loadWorktreeSessions(excludeDirectory)
}

/**
 * Load sessions for all ready worktrees that don't already have them.
 * Extracted so it can be called independently when worktree metadata
 * arrives after the initial loadAllProjectSessions call.
 */
export function loadWorktreeSessions(excludeDirectory?: string): void {
	const worktrees = useWorktreeStore.getState().worktrees
	for (const wt of worktrees.values()) {
		if (wt.directory === excludeDirectory) continue
		if (wt.status !== "ready") continue
		const existing = workspaceStoreRegistry.get(wt.directory)
		if (existing && existing.getState().sessions.length > 0) continue
		const store = workspaceStoreRegistry.getOrCreate(wt.directory)
		apiClient
			.get<any[]>("/sessions", { directory: wt.directory })
			.then((sessions) => store.getState().initSessions(sessions))
			.catch((err) => console.error(`[bootstrap:worktree-sessions] ${wt.branch}:`, err))
	}
}
