import type { McpServerHttpConfig, McpServerStdioConfig } from "@core/schema/mcp"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { buildSubprocessEnv } from "../lib/env-filter"
import { createLogger } from "../logger"

const log = createLogger("mcp:transport")

/**
 * Create a STDIO transport for a local MCP server process.
 *
 * Env is filtered to a safe allowlist (HOME, PATH, SHELL, etc.) plus any
 * server-specific vars listed in `config.envPassthrough`. This prevents
 * a malicious or compromised MCP server from reading the parent process's
 * API keys and OAuth tokens directly from its own environment.
 */
export function createStdioTransport(
	config: McpServerStdioConfig,
	cwd: string,
): StdioClientTransport {
	const env = buildSubprocessEnv(config.envPassthrough ?? [], config.env ?? {})

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

/** Resolve HTTP headers from config (static headers, bearer token, env-based headers). */
export function resolveHttpHeaders(config: McpServerHttpConfig): Record<string, string> {
	const headers: Record<string, string> = { ...(config.headers ?? {}) }

	if (config.bearerTokenEnvVar) {
		const token = process.env[config.bearerTokenEnvVar]
		if (token) {
			headers.Authorization = `Bearer ${token}`
		} else {
			log.warn("Bearer token env var not set", { envVar: config.bearerTokenEnvVar })
		}
	}

	if (config.headersFromEnv) {
		for (const [headerName, envVar] of Object.entries(config.headersFromEnv)) {
			const value = process.env[envVar]
			if (value) headers[headerName] = value
		}
	}

	return headers
}

/**
 * Connect an HTTP MCP client by trying transports in order.
 * Tries StreamableHTTP first, falls back to SSE for older servers.
 * Returns the connected transport (the client is already connected).
 */
export async function connectHttpClient(
	client: Client,
	config: McpServerHttpConfig,
	timeout: number,
): Promise<Transport> {
	const headers = resolveHttpHeaders(config)
	const url = new URL(config.url)
	const requestInit = Object.keys(headers).length > 0 ? { headers } : undefined

	const transports: Array<{ name: string; transport: Transport }> = [
		{ name: "StreamableHTTP", transport: new StreamableHTTPClientTransport(url, { requestInit }) },
		{ name: "SSE", transport: new SSEClientTransport(url, { requestInit }) },
	]

	let lastError: Error | undefined
	for (const { name, transport } of transports) {
		try {
			await withTimeout(client.connect(transport), timeout)
			log.info("HTTP transport connected", { url: config.url, transport: name })
			return transport
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err))
			log.debug("HTTP transport failed, trying next", {
				url: config.url,
				transport: name,
				error: lastError.message,
			})
		}
	}

	throw lastError ?? new Error("All HTTP transports failed")
}

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
