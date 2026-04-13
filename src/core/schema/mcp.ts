import { z } from "zod"

// ── Server Config (persisted in config.json) ─────────────────

export const McpServerStdioConfigSchema = z.object({
	type: z.literal("stdio"),
	command: z.string(),
	args: z.array(z.string()).default([]),
	env: z.record(z.string(), z.string()).optional(),
	envPassthrough: z.array(z.string()).optional(),
	cwd: z.string().optional(),
	timeout: z.number().positive().optional(),
	enabled: z.boolean().default(true),
})

/**
 * Validate that a URL uses an approved scheme and does not point at cloud
 * metadata services. Private/loopback IPs are allowed (users legitimately
 * run MCP servers on localhost) but the well-known cloud metadata endpoint
 * 169.254.169.254 is blocked outright.
 */
function isSafeMcpUrl(raw: string): boolean {
	let parsed: URL
	try {
		parsed = new URL(raw)
	} catch {
		return false
	}
	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false
	const host = parsed.hostname.toLowerCase()
	if (host === "169.254.169.254" || host === "[fd00:ec2::254]") return false
	// Block link-local IPv4 169.254/16 entirely (covers cloud metadata + Windows APIPA)
	if (/^169\.254\./.test(host)) return false
	return true
}

export const McpServerHttpConfigSchema = z.object({
	type: z.literal("http"),
	url: z
		.string()
		.url()
		.refine(isSafeMcpUrl, "MCP URL must be http(s) and not a cloud metadata endpoint"),
	headers: z.record(z.string(), z.string()).optional(),
	/** Name of an env var holding a bearer token (e.g. "MCP_BEARER_TOKEN"). */
	bearerTokenEnvVar: z.string().optional(),
	/** Headers whose values come from environment variables: { headerName: envVarName }. */
	headersFromEnv: z.record(z.string(), z.string()).optional(),
	timeout: z.number().positive().optional(),
	enabled: z.boolean().default(true),
})

export const McpServerConfigSchema = z.discriminatedUnion("type", [
	McpServerStdioConfigSchema,
	McpServerHttpConfigSchema,
])

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>
export type McpServerStdioConfig = z.infer<typeof McpServerStdioConfigSchema>
export type McpServerHttpConfig = z.infer<typeof McpServerHttpConfigSchema>

// ── Server Status (runtime only, not persisted) ──────────────

export const McpServerStatusSchema = z.enum(["connected", "connecting", "disconnected", "failed"])
export type McpServerStatus = z.infer<typeof McpServerStatusSchema>

export const McpServerInfoSchema = z.object({
	name: z.string(),
	config: McpServerConfigSchema,
	status: McpServerStatusSchema,
	error: z.string().optional(),
	toolCount: z.number().default(0),
})

export type McpServerInfo = z.infer<typeof McpServerInfoSchema>

// ── MCP Tool metadata (for internal use) ─────────────────────

export interface McpToolEntry {
	serverName: string
	toolName: string
	description: string
	inputSchema: Record<string, unknown>
}
