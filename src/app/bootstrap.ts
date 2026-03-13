import type { AppConfig } from "@core/schema/config"
import { DEFAULT_CONFIG } from "@core/schema/config"
import { apiClient } from "./lib/api-client"
import { sseClient } from "./lib/sse-client"
import { tauriBridge } from "./lib/tauri-bridge"
import { useAgentStore } from "./stores/agent-store"
import { useConfigStore } from "./stores/config-store"
import { useProjectStore } from "./stores/project-store"
import { useProviderStore } from "./stores/provider-store"
import { workspaceStoreRegistry } from "./stores/workspace-store"

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
	const { url, token } = await tauriBridge.getServerInfo()
	await healthPoll(url, { maxAttempts: 30, intervalMs: 200 })

	apiClient.init(url, token)
	sseClient.init(url, token)

	const [providerData, projects, agents, config] = await Promise.all([
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
	])

	useConfigStore.getState().init(config)
	useProviderStore.getState().init(providerData, config.defaultModel)
	useProjectStore.getState().init(projects)
	useAgentStore.getState().init(agents, config.defaultAgent)
}

/**
 * Wave 2: Workspace bootstrap. Called when navigating to a workspace.
 * Step 1 is blocking (must complete before workspace UI renders).
 * Step 2 is fire-and-forget (loads in background).
 */
export async function bootstrapWorkspace(directory: string): Promise<void> {
	// Step 1: Blocking -- triggers server-side WorkspaceBootstrap
	await apiClient.get("/project/current", { directory })

	// Step 2: Non-blocking -- UI renders immediately
	apiClient.setWorkspaceDirectory(directory)
	const store = workspaceStoreRegistry.getOrCreate(directory)

	Promise.all([
		apiClient.get("/sessions", { directory }).then((sessions) => {
			store.getState().initSessions(sessions as any[])
		}),
		apiClient.get("/vcs/branch", { directory }).then((branch) => {
			store.getState().initVcs(branch as any)
		}),
	]).catch((err) => console.error("[bootstrap:workspace]", err))

	sseClient.ensureConnected()
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
		apiClient
			.get<any[]>("/sessions", { directory: project.directory })
			.then((sessions) => {
				store.getState().initSessions(sessions)
			})
			.catch((err) => {
				console.error(`[bootstrap:sessions] ${project.name}:`, err)
			})
	}
}
