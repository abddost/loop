import type { McpServerConfig as LoopMcpServerConfig } from "@core/schema/mcp"
import * as Config from "../../config"
import { createLogger } from "../../logger"
import { Workspace } from "../../workspace"

/**
 * NOT CURRENTLY WIRED.
 *
 * Passing `mcpServers` to `Agent.create()` was empirically observed to break
 * Cursor's built-in tool registration (Read/Glob/Grep return empty results;
 * Shell still works) — see commit history. Until the SDK provides a stable
 * way to combine inline MCP servers with built-in tools we leave this
 * helper as scaffolding. To re-enable, import + call `buildCursorMcpServers`
 * inside `session-runtime.ts::createOrResume` and pass the result to
 * `Agent.create` / `Agent.resume`.
 *
 * Translate Loop's MCP config (enabled stdio/http servers from
 * `~/.config/loop/config.json`) into the shape Cursor's SDK expects on
 * `Agent.create({ mcpServers: ... })`.
 *
 * Differences we paper over:
 *   - Loop has `enabled: false` flags; Cursor has no concept of disabled
 *     servers. We omit disabled entries.
 *   - Loop's HTTP servers can carry `bearerTokenEnvVar` / `headersFromEnv`
 *     to pull secrets from the host process env; Cursor expects
 *     pre-resolved `headers`. We resolve here.
 *   - Loop ignores `timeout` (Cursor's SDK has no equivalent param).
 *   - Cursor accepts `type: "sse"` but Loop doesn't expose that variant —
 *     stdio + http only.
 *
 * Returned object is the format Cursor's `Agent.create` consumes directly:
 * `Record<string, McpServerConfig>` keyed by server name.
 */

const log = createLogger("cursor-mcp-config")

type CursorStdio = {
	type: "stdio"
	command: string
	args?: string[]
	env?: Record<string, string>
	cwd?: string
}

type CursorHttp = {
	type: "http" | "sse"
	url: string
	headers?: Record<string, string>
}

type CursorMcpServer = CursorStdio | CursorHttp

export function buildCursorMcpServers(): Record<string, CursorMcpServer> | undefined {
	let cwd: string
	try {
		cwd = Workspace.dir()
	} catch {
		// Not in a workspace context — return nothing rather than guess.
		return undefined
	}

	const config = Config.read(cwd)
	const mcpConfig = config.mcp ?? {}

	const out: Record<string, CursorMcpServer> = {}
	for (const [name, server] of Object.entries(mcpConfig)) {
		if (!server.enabled) continue
		const translated = translateServer(name, server)
		if (translated) out[name] = translated
	}

	return Object.keys(out).length > 0 ? out : undefined
}

function translateServer(name: string, server: LoopMcpServerConfig): CursorMcpServer | undefined {
	if (server.type === "stdio") {
		const out: CursorStdio = {
			type: "stdio",
			command: server.command,
		}
		if (server.args && server.args.length > 0) out.args = [...server.args]
		const env = resolveStdioEnv(server.env, server.envPassthrough)
		if (env) out.env = env
		if (server.cwd) out.cwd = server.cwd
		return out
	}
	if (server.type === "http") {
		const headers = resolveHttpHeaders(
			server.headers,
			server.bearerTokenEnvVar,
			server.headersFromEnv,
			name,
		)
		const out: CursorHttp = {
			type: "http",
			url: server.url,
		}
		if (headers) out.headers = headers
		return out
	}
	return undefined
}

function resolveStdioEnv(
	env: Record<string, string> | undefined,
	passthrough: string[] | undefined,
): Record<string, string> | undefined {
	const out: Record<string, string> = {}
	if (env) {
		for (const [k, v] of Object.entries(env)) out[k] = v
	}
	if (passthrough) {
		for (const key of passthrough) {
			const value = process.env[key]
			if (value !== undefined) out[key] = value
		}
	}
	return Object.keys(out).length > 0 ? out : undefined
}

function resolveHttpHeaders(
	headers: Record<string, string> | undefined,
	bearerTokenEnvVar: string | undefined,
	headersFromEnv: Record<string, string> | undefined,
	serverName: string,
): Record<string, string> | undefined {
	const out: Record<string, string> = {}
	if (headers) {
		for (const [k, v] of Object.entries(headers)) out[k] = v
	}
	if (bearerTokenEnvVar) {
		const token = process.env[bearerTokenEnvVar]
		if (token) {
			out.Authorization = `Bearer ${token}`
		} else {
			log.warn("MCP server bearer token env var not set", {
				server: serverName,
				envVar: bearerTokenEnvVar,
			})
		}
	}
	if (headersFromEnv) {
		for (const [headerName, envVarName] of Object.entries(headersFromEnv)) {
			const value = process.env[envVarName]
			if (value !== undefined) out[headerName] = value
		}
	}
	return Object.keys(out).length > 0 ? out : undefined
}
