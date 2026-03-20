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

export const McpServerHttpConfigSchema = z.object({
	type: z.literal("http"),
	url: z.string().url(),
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
