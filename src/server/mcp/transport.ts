import type { McpServerHttpConfig, McpServerStdioConfig } from "@core/schema/mcp"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { createLogger } from "../logger"

const log = createLogger("mcp:transport")

/**
 * Create a STDIO transport for a local MCP server process.
 * Merges process.env with config.env and envPassthrough.
 */
export function createStdioTransport(
	config: McpServerStdioConfig,
	cwd: string,
): StdioClientTransport {
	const env: Record<string, string> = {}

	// Pass through selected env vars from process.env
	if (config.envPassthrough) {
		for (const key of config.envPassthrough) {
			if (process.env[key]) env[key] = process.env[key]!
		}
	}

	// Merge config env (overrides passthrough)
	if (config.env) {
		Object.assign(env, config.env)
	}

	// Always pass PATH so the command can be found
	if (!env.PATH && process.env.PATH) {
		env.PATH = process.env.PATH
	}

	const transport = new StdioClientTransport({
		command: config.command,
		args: config.args,
		env,
		cwd: config.cwd ?? cwd,
		stderr: "pipe",
	})

	transport.stderr?.on("data", (chunk: Buffer) => {
		log.info("stdio stderr", { data: chunk.toString().trim() })
	})

	return transport
}

/**
 * Create an HTTP transport for a remote MCP server.
 * Tries StreamableHTTP first, falls back to SSE for older servers.
 */
export async function createHttpTransport(config: McpServerHttpConfig): Promise<Transport> {
	const headers: Record<string, string> = { ...(config.headers ?? {}) }

	// Resolve bearer token from environment variable
	if (config.bearerTokenEnvVar) {
		const token = process.env[config.bearerTokenEnvVar]
		if (token) {
			headers.Authorization = `Bearer ${token}`
		} else {
			log.warn("Bearer token env var not set", { envVar: config.bearerTokenEnvVar })
		}
	}

	// Resolve headers from environment variables
	if (config.headersFromEnv) {
		for (const [headerName, envVar] of Object.entries(config.headersFromEnv)) {
			const value = process.env[envVar]
			if (value) headers[headerName] = value
		}
	}

	const url = new URL(config.url)
	const requestInit = Object.keys(headers).length > 0 ? { headers } : undefined

	// Try StreamableHTTP first
	try {
		const transport = new StreamableHTTPClientTransport(url, { requestInit })
		return transport
	} catch (err) {
		log.info("StreamableHTTP transport creation failed, trying SSE", { error: err })
	}

	// Fall back to SSE
	return new SSEClientTransport(url, { requestInit })
}
