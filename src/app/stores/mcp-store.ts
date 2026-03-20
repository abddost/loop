import type { McpServerConfig, McpServerInfo } from "@core/schema/mcp"
import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { apiClient } from "../lib/api-client"

interface McpState {
	servers: McpServerInfo[]
	init(servers: McpServerInfo[]): void
	refresh(): Promise<void>
	addServer(name: string, config: McpServerConfig): Promise<void>
	removeServer(name: string): Promise<void>
	connectServer(name: string): Promise<void>
	disconnectServer(name: string): Promise<void>
	restartServer(name: string): Promise<void>
	restartAll(): Promise<void>
}

export const useMcpStore = create<McpState>()(
	immer((set) => ({
		servers: [],

		init(servers) {
			set((s) => {
				s.servers = servers
			})
		},

		async refresh() {
			try {
				const servers = await apiClient.get<McpServerInfo[]>("/mcp/servers")
				set((s) => {
					s.servers = servers
				})
			} catch (err) {
				console.error("[mcp:refresh]", err)
			}
		},

		async addServer(name, config) {
			await apiClient.post("/mcp/servers", { name, config })
			await useMcpStore.getState().refresh()
		},

		async removeServer(name) {
			await apiClient.del(`/mcp/servers/${encodeURIComponent(name)}`)
			await useMcpStore.getState().refresh()
		},

		async connectServer(name) {
			await apiClient.post(`/mcp/servers/${encodeURIComponent(name)}/connect`)
			await useMcpStore.getState().refresh()
		},

		async disconnectServer(name) {
			await apiClient.post(`/mcp/servers/${encodeURIComponent(name)}/disconnect`)
			await useMcpStore.getState().refresh()
		},

		async restartServer(name) {
			await apiClient.post(`/mcp/servers/${encodeURIComponent(name)}/restart`)
			await useMcpStore.getState().refresh()
		},

		async restartAll() {
			const connected = useMcpStore.getState().servers.filter((s) => s.status === "connected")
			await Promise.all(
				connected.map((s) => apiClient.post(`/mcp/servers/${encodeURIComponent(s.name)}/restart`)),
			)
			await useMcpStore.getState().refresh()
		},
	})),
)
