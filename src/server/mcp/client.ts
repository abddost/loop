import type { McpServerConfig, McpServerStatus, McpToolEntry } from "@core/schema/mcp"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import {
	CallToolResultSchema,
	ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { createLogger } from "../logger"
import { connectHttpClient, createStdioTransport } from "./transport"

const log = createLogger("mcp:client")
const DEFAULT_TIMEOUT = 60_000

/**
 * Manages a single MCP server connection.
 * Handles transport creation, tool discovery, tool execution, and cleanup.
 */
export class McpClient {
	readonly name: string
	readonly config: McpServerConfig

	private client: Client | null = null
	private transport: Transport | null = null
	private _status: McpServerStatus = "disconnected"
	private _error: string | undefined
	private _tools: McpToolEntry[] = []

	constructor(name: string, config: McpServerConfig) {
		this.name = name
		this.config = config
	}

	get status(): McpServerStatus {
		return this._status
	}

	get error(): string | undefined {
		return this._error
	}

	get toolCount(): number {
		return this._tools.length
	}

	/** Get the cached list of tools from this server. */
	tools(): McpToolEntry[] {
		return this._tools
	}

	/**
	 * Connect to the MCP server, discover tools, and subscribe to changes.
	 * @param cwd - Working directory for STDIO servers
	 */
	async connect(cwd: string): Promise<void> {
		if (this._status === "connected" || this._status === "connecting") return

		this._status = "connecting"
		this._error = undefined

		const timeout = this.config.timeout ?? DEFAULT_TIMEOUT

		try {
			this.client = new Client({ name: "loop", version: "0.1.0" })

			if (this.config.type === "stdio") {
				this.transport = createStdioTransport(this.config, cwd)
				await withTimeout(this.client.connect(this.transport), timeout)
			} else {
				// HTTP: tries StreamableHTTP first, falls back to SSE
				this.transport = await connectHttpClient(this.client, this.config, timeout)
			}

			// Validate connection by listing tools
			const toolResult = await withTimeout(this.client.listTools(), timeout)
			this._tools = (toolResult.tools ?? []).map((tool) => ({
				serverName: this.name,
				toolName: tool.name,
				description: tool.description ?? "",
				inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
			}))

			// Subscribe to tool list changes
			this.client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
				log.info("Tool list changed", { server: this.name })
				this.refreshTools().catch((err) =>
					log.warn("Failed to refresh tools after change", { server: this.name, error: err }),
				)
			})

			this._status = "connected"
			log.info("Connected to MCP server", {
				name: this.name,
				tools: this._tools.length,
			})
		} catch (err) {
			this._status = "failed"
			this._error = err instanceof Error ? err.message : String(err)
			this._tools = []
			log.error("Failed to connect MCP server", {
				name: this.name,
				error: this._error,
			})

			await this.cleanupConnection()
		}
	}

	/** Disconnect from the MCP server and clean up resources. */
	async disconnect(): Promise<void> {
		if (this._status === "disconnected") return

		await this.cleanupConnection()

		this._status = "disconnected"
		this._error = undefined
		this._tools = []
		log.info("Disconnected from MCP server", { name: this.name })
	}

	/**
	 * Call a tool on this MCP server.
	 * @returns The text output from the tool
	 */
	async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
		if (!this.client || this._status !== "connected") {
			throw new Error(`MCP server "${this.name}" is not connected`)
		}

		const timeout = this.config.timeout ?? DEFAULT_TIMEOUT

		const result = await this.client.callTool(
			{ name: toolName, arguments: args },
			CallToolResultSchema,
			{ timeout, resetTimeoutOnProgress: true },
		)

		// Extract text content from the result
		const parts: string[] = []
		if (result.content && Array.isArray(result.content)) {
			for (const item of result.content) {
				if (item.type === "text" && typeof item.text === "string") {
					parts.push(item.text)
				} else if (item.type === "image") {
					parts.push(`[Image: ${(item as any).mimeType ?? "image"}]`)
				} else if (item.type === "resource") {
					const resource = item as any
					if (resource.resource?.text) {
						parts.push(resource.resource.text)
					} else {
						parts.push(`[Resource: ${resource.resource?.uri ?? "unknown"}]`)
					}
				}
			}
		}

		if (result.isError) {
			const errorText = parts.join("\n") || "Unknown MCP tool error"
			throw new Error(errorText)
		}

		return parts.join("\n\n") || "(empty result)"
	}

	/** Re-fetch the tool list from the server. */
	private async refreshTools(): Promise<void> {
		if (!this.client) return

		try {
			const result = await this.client.listTools()
			this._tools = (result.tools ?? []).map((tool) => ({
				serverName: this.name,
				toolName: tool.name,
				description: tool.description ?? "",
				inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
			}))
		} catch (err) {
			log.warn("Failed to list tools", {
				server: this.name,
				error: err instanceof Error ? err.message : String(err),
			})
			this._tools = []
		}
	}

	/** Clean up transport and client, killing the full process tree for STDIO. */
	private async cleanupConnection(): Promise<void> {
		// Kill descendant processes first (prevents orphaned grandchild processes
		// from servers like chrome-devtools-mcp that spawn sub-processes)
		const pid = (this.transport as any)?.pid
		if (typeof pid === "number") {
			for (const dpid of await descendants(pid)) {
				try {
					process.kill(dpid, "SIGTERM")
				} catch {
					// Process may already be gone
				}
			}
		}

		try {
			if (this.client) {
				await this.client.close().catch(() => {})
			}
		} catch {
			// Ignore cleanup errors
		}
		this.client = null
		this.transport = null
	}
}

/** Run a promise with a timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
		promise.then(
			(val) => {
				clearTimeout(timer)
				resolve(val)
			},
			(err) => {
				clearTimeout(timer)
				reject(err)
			},
		)
	})
}

/** Collect all descendant PIDs of a process (for full tree cleanup). */
async function descendants(pid: number): Promise<number[]> {
	if (process.platform === "win32") return []
	const pids: number[] = []
	const queue = [pid]
	while (queue.length > 0) {
		const current = queue.shift()!
		try {
			const proc = Bun.spawn(["pgrep", "-P", String(current)], {
				stdout: "pipe",
				stderr: "pipe",
			})
			const [code, out] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
			if (code !== 0) continue
			for (const tok of out.trim().split(/\s+/)) {
				const cpid = Number.parseInt(tok, 10)
				if (!Number.isNaN(cpid) && !pids.includes(cpid)) {
					pids.push(cpid)
					queue.push(cpid)
				}
			}
		} catch {
			// pgrep may not be available
		}
	}
	return pids
}
