import type { McpServerConfig, McpServerStatus, McpToolEntry } from "@core/schema/mcp"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js"
import { createLogger } from "../logger"
import { createHttpTransport, createStdioTransport } from "./transport"

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

		try {
			// Create transport based on config type
			if (this.config.type === "stdio") {
				this.transport = createStdioTransport(this.config, cwd)
			} else {
				this.transport = await createHttpTransport(this.config)
			}

			// Create MCP client and connect
			this.client = new Client({ name: "loop", version: "0.1.0" })

			const timeout = this.config.timeout ?? DEFAULT_TIMEOUT
			await withTimeout(this.client.connect(this.transport), timeout)

			// Discover tools
			await this.refreshTools()

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

			// Cleanup partial connection
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

		const result = await withTimeout(
			this.client.callTool({
				name: toolName,
				arguments: args,
			}),
			timeout,
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

	/** Clean up transport and client without changing status. */
	private async cleanupConnection(): Promise<void> {
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
