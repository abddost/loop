import type { McpServerConfig, McpServerInfo } from "@core/schema/mcp"
import { z } from "zod"
import * as Config from "../config"
import { createLogger } from "../logger"
import { Tool } from "../tool/shape"
import { Workspace } from "../workspace"
import { bus } from "../workspace/bus"
import { McpClient } from "./client"

const log = createLogger("mcp")

/** Sanitize a name for use in tool IDs (alphanumeric + underscores). */
function sanitize(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]/g, "_")
}

// ── Per-workspace state ──────────────────────────────────────

interface McpState {
	clients: Map<string, McpClient>
}

const mcpState = Workspace.state<McpState>(
	() => ({ clients: new Map() }),
	async (state) => {
		const errors: Error[] = []
		for (const [name, client] of state.clients) {
			try {
				await client.disconnect()
			} catch (e) {
				log.error("Failed to disconnect MCP client on dispose", { name, error: e })
				errors.push(e as Error)
			}
		}
		state.clients.clear()
		if (errors.length) throw new AggregateError(errors, "MCP dispose errors")
	},
)

// ── Emit status changes ──────────────────────────────────────

function emitStatus(client: McpClient): void {
	try {
		bus().emit("mcp:status", {
			name: client.name,
			status: client.status,
			error: client.error,
			toolCount: client.toolCount,
		})
	} catch {
		// Bus may not be available
	}
}

// ── Public API ───────────────────────────────────────────────

/**
 * Initialize MCP clients from config. Called during workspace bootstrap.
 * Reads the `mcp` key from config.json and creates + connects enabled servers.
 */
export async function initFromConfig(): Promise<void> {
	const config = Config.read()
	const mcpConfig = config.mcp ?? {}
	const state = mcpState()
	const cwd = Workspace.dir()

	const connectPromises: Promise<void>[] = []

	for (const [name, serverConfig] of Object.entries(mcpConfig)) {
		if (serverConfig.enabled === false) {
			const client = new McpClient(name, serverConfig)
			state.clients.set(name, client)
			continue
		}

		const client = new McpClient(name, serverConfig)
		state.clients.set(name, client)

		connectPromises.push(
			client
				.connect(cwd)
				.then(() => emitStatus(client))
				.catch((err) => {
					log.warn("MCP init connect failed", { name, error: err })
					emitStatus(client)
				}),
		)
	}

	// Connect all enabled servers in parallel, don't block startup
	if (connectPromises.length > 0) {
		await Promise.allSettled(connectPromises)
	}
}

/**
 * Add a new MCP server configuration and optionally connect it.
 * Persists the config to disk.
 */
export async function add(name: string, serverConfig: McpServerConfig): Promise<void> {
	const state = mcpState()

	// Disconnect existing client with same name if any
	const existing = state.clients.get(name)
	if (existing) {
		await existing.disconnect()
	}

	// Persist to config
	Config.write({ mcp: { [name]: serverConfig } })

	// Create and connect
	const client = new McpClient(name, serverConfig)
	state.clients.set(name, client)

	if (serverConfig.enabled !== false) {
		await client.connect(Workspace.dir())
	}

	emitStatus(client)
}

/** Remove an MCP server. Disconnects and removes from config. */
export async function remove(name: string): Promise<void> {
	const state = mcpState()
	const client = state.clients.get(name)

	if (client) {
		await client.disconnect()
		state.clients.delete(name)
	}

	// Remove from config (set to null for deep-merge deletion)
	const config = Config.read()
	const mcp = { ...config.mcp }
	delete mcp[name]
	// Write the entire mcp object to replace
	Config.invalidate()
	const filePath = Config.path()
	try {
		const { readFileSync, writeFileSync, renameSync } = await import("node:fs")
		const raw = JSON.parse(readFileSync(filePath, "utf-8"))
		if (raw.mcp) delete raw.mcp[name]
		const tmpPath = `${filePath}.tmp`
		writeFileSync(tmpPath, `${JSON.stringify(raw, null, 2)}\n`, "utf-8")
		renameSync(tmpPath, filePath)
		Config.invalidate()
	} catch (err) {
		log.warn("Failed to remove MCP server from config", { name, error: err })
	}

	emitStatus(new McpClient(name, { type: "stdio", command: "", args: [], enabled: false }))
}

/** Connect (or reconnect) a named MCP server. */
export async function connect(name: string): Promise<void> {
	const state = mcpState()
	const client = state.clients.get(name)
	if (!client) throw new Error(`MCP server "${name}" not found`)

	await client.connect(Workspace.dir())
	emitStatus(client)
}

/** Disconnect a named MCP server. */
export async function disconnect(name: string): Promise<void> {
	const state = mcpState()
	const client = state.clients.get(name)
	if (!client) throw new Error(`MCP server "${name}" not found`)

	await client.disconnect()
	emitStatus(client)
}

/** Restart a named MCP server (disconnect → connect). */
export async function restart(name: string): Promise<void> {
	const state = mcpState()
	const client = state.clients.get(name)
	if (!client) throw new Error(`MCP server "${name}" not found`)

	await client.disconnect()
	await client.connect(Workspace.dir())
	emitStatus(client)
}

/** Get status info for all configured MCP servers. */
export function status(): McpServerInfo[] {
	const state = mcpState()
	const result: McpServerInfo[] = []

	for (const [name, client] of state.clients) {
		result.push({
			name,
			config: client.config,
			status: client.status,
			error: client.error,
			toolCount: client.toolCount,
		})
	}

	return result
}

/**
 * Convert all connected MCP servers' tools into Tool.Shape objects
 * for use in the agentic loop. Tool IDs are prefixed with `mcp_`.
 */
export function allMcpTools(): Tool.Shape[] {
	const state = mcpState()
	const shapes: Tool.Shape[] = []

	for (const [, client] of state.clients) {
		if (client.status !== "connected") continue

		for (const entry of client.tools()) {
			const toolId = `mcp_${sanitize(entry.serverName)}_${sanitize(entry.toolName)}`
			const mcpClient = client

			shapes.push(
				Tool.define(toolId, {
					description: entry.description || `MCP tool: ${entry.serverName}/${entry.toolName}`,
					// MCP tools accept arbitrary JSON matching their schema.
					// We use passthrough() so Zod doesn't strip unknown keys.
					parameters: z.object({}).passthrough(),
					async execute(ctx, input) {
						await ctx.ask({
							permission: "mcp",
							patterns: [`${entry.serverName}/${entry.toolName}`],
							always: [`${entry.serverName}/*`],
							metadata: {
								reason: `MCP tool: ${entry.serverName}/${entry.toolName}`,
							},
						})

						const result = await mcpClient.callTool(entry.toolName, input)
						return { output: result }
					},
				}),
			)
		}
	}

	return shapes
}
