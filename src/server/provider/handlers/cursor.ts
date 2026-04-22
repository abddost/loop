import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir, platform } from "node:os"
import { join } from "node:path"
import { CURSOR_PROVIDER_ID, getEffortSuffix, inferFamily } from "@core/cursor-tiers"
import type { OAuthAuth } from "@core/schema/provider"
import type { LanguageModel } from "ai"
import { createLogger } from "../../logger"
import { Workspace } from "../../workspace"
import type { AuthAuthorization, AuthHandler, AuthResult } from "../auth-handler"
import type { ModelInfo, ProviderConfig, ProviderCredentials } from "../base"
import { createLanguageModel } from "../sdk"
import {
	type OpenAiMessage,
	type OpenAiTool,
	buildCursorPrompt,
	createCursorSseStream,
	extractAllowedToolNames,
	getCursorAgentCmd,
	stripAnsi,
} from "./cursor-runtime"
import {
	conversationKey,
	getCachedSession,
	invalidateCachedSession,
	setCachedSession,
} from "./cursor-session-cache"

const log = createLogger("auth:cursor")

// ─── Auth File Paths ────────────────────────────────────────────

const AUTH_FILES = ["cli-config.json", "auth.json"]

function getHomeDir(): string {
	return process.env.CURSOR_ACP_HOME_DIR || homedir()
}

/**
 * All possible Cursor auth file paths in priority order.
 * macOS: ~/.cursor/ first, then ~/.config/cursor/
 * Linux: ~/.config/cursor/ first (XDG), then ~/.cursor/
 */
function getAuthPaths(): string[] {
	const home = getHomeDir()
	const paths: string[] = []

	if (platform() === "darwin") {
		for (const file of AUTH_FILES) paths.push(join(home, ".cursor", file))
		for (const file of AUTH_FILES) paths.push(join(home, ".config", "cursor", file))
	} else {
		for (const file of AUTH_FILES) paths.push(join(home, ".config", "cursor", file))
		const xdg = process.env.XDG_CONFIG_HOME
		if (xdg && xdg !== join(home, ".config")) {
			for (const file of AUTH_FILES) paths.push(join(xdg, "cursor", file))
		}
		for (const file of AUTH_FILES) paths.push(join(home, ".cursor", file))
	}

	return paths
}

/** Check if any Cursor auth file exists on disk. */
export function isCursorAuthenticated(): boolean {
	return getAuthPaths().some((p) => existsSync(p))
}

// ─── Auth File Polling ──────────────────────────────────────────

const AUTH_POLL_INTERVAL = 2_000
const AUTH_POLL_TIMEOUT = 5 * 60 * 1000
const URL_EXTRACT_TIMEOUT = 10_000

function pollForAuthFile(): Promise<boolean> {
	const paths = getAuthPaths()
	const start = Date.now()

	return new Promise((resolve) => {
		const check = () => {
			if (paths.some((p) => existsSync(p))) {
				resolve(true)
				return
			}
			if (Date.now() - start >= AUTH_POLL_TIMEOUT) {
				resolve(false)
				return
			}
			setTimeout(check, AUTH_POLL_INTERVAL)
		}
		check()
	})
}

// ─── Models ─────────────────────────────────────────────────────

function model(id: string, name: string, opts: Partial<ModelInfo> = {}): ModelInfo {
	const family = inferFamily(id)
	return {
		id,
		name,
		providerId: CURSOR_PROVIDER_ID,
		...(family ? { family } : {}),
		supportsImages: true,
		supportsTools: true,
		supportsReasoning: false,
		supportsTemperature: false,
		contextWindow: 200_000,
		maxOutput: 16384,
		pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		status: "active" as const,
		modalities: { input: ["text", "image"], output: ["text"] },
		...opts,
	}
}

const thinking = { supportsReasoning: true, maxOutput: 65536 } as const
const million = { contextWindow: 1_000_000, maxOutput: 65536 } as const
const millionThinking = {
	contextWindow: 1_000_000,
	maxOutput: 65536,
	supportsReasoning: true,
} as const

/**
 * Hardcoded fallback — used when `cursor-agent --list-models` is
 * unavailable at startup (e.g. cursor-agent not installed yet).
 * Superseded by discovered list once cursor-agent responds. Kept
 * intentionally small: the five tier anchors Loop's UI cares about
 * (Auto / Premium / MAX) plus a few popular specific picks.
 */
const FALLBACK_MODELS: ModelInfo[] = [
	model("auto", "Auto"),
	// Claude 4.7 Opus (newest as of April 2026)
	model("claude-opus-4-7-max", "Opus 4.7 1M Max", million),
	model("claude-opus-4-7-high", "Opus 4.7 1M", million),
	model("claude-opus-4-7-thinking-high", "Opus 4.7 1M Thinking", millionThinking),
	model("claude-opus-4-7-thinking-max", "Opus 4.7 1M Max Thinking", millionThinking),
	// Claude 4.6 Opus/Sonnet
	model("claude-4.6-opus-max", "Opus 4.6 1M Max", million),
	model("claude-4.6-opus-high", "Opus 4.6 1M", million),
	model("claude-4.6-opus-max-thinking", "Opus 4.6 1M Max Thinking", millionThinking),
	model("claude-4.6-opus-high-thinking", "Opus 4.6 1M Thinking", millionThinking),
	model("claude-4.6-sonnet-medium", "Sonnet 4.6 1M", million),
	model("claude-4.6-sonnet-medium-thinking", "Sonnet 4.6 1M Thinking", millionThinking),
	// Claude 4.5
	model("claude-4.5-opus-high", "Opus 4.5", { maxOutput: 32768 }),
	model("claude-4.5-opus-high-thinking", "Opus 4.5 Thinking", thinking),
	model("claude-4.5-sonnet", "Sonnet 4.5 1M", million),
	model("claude-4.5-sonnet-thinking", "Sonnet 4.5 1M Thinking", millionThinking),
	// GPT-5.4
	model("gpt-5.4-xhigh", "GPT-5.4 1M Extra High", million),
	model("gpt-5.4-high", "GPT-5.4 1M High", million),
	model("gpt-5.4-medium", "GPT-5.4 1M", million),
	// GPT-5.3 Codex
	model("gpt-5.3-codex-xhigh", "Codex 5.3 Extra High", { maxOutput: 32768 }),
	model("gpt-5.3-codex-high", "Codex 5.3 High", { maxOutput: 32768 }),
	model("gpt-5.3-codex", "Codex 5.3", { maxOutput: 32768 }),
	// Composer / Cursor native
	model("composer-2-fast", "Composer 2 Fast"),
	model("composer-2", "Composer 2"),
	model("composer-1.5", "Composer 1.5"),
	// Gemini / Grok / Kimi
	model("gemini-3.1-pro", "Gemini 3.1 Pro", million),
	model("gemini-3-flash", "Gemini 3 Flash"),
	model("grok-4-20", "Grok 4.20"),
	model("grok-4-20-thinking", "Grok 4.20 Thinking", thinking),
	model("kimi-k2.5", "Kimi K2.5"),
]

/** Infer a ModelInfo patch from an id / display name pair. */
function inferModelCapabilities(id: string, name: string): Partial<ModelInfo> {
	const lowerId = id.toLowerCase()
	const lowerName = name.toLowerCase()
	const effort = getEffortSuffix(lowerId)
	const isThinking = lowerId.includes("thinking")

	// Context window heuristics: claude-4.7/4.6/4.5 opus/sonnet are all 1M,
	// GPT-5.4 family is 1M, Gemini is 1M, display-name tag "1M" is explicit.
	const hasMillion =
		lowerName.includes("1m") ||
		lowerId.includes("opus-4-7") ||
		lowerId.includes("4.6-opus") ||
		lowerId.includes("4.6-sonnet") ||
		lowerId.includes("4.5-sonnet") ||
		lowerId.includes("gpt-5.4") ||
		lowerId.startsWith("gemini-3") ||
		lowerId.includes("sonnet-1m")

	// Max-output: thinking models emit long reasoning; -max / -xhigh effort
	// typically ships with extended completion budgets.
	const largeOutput = isThinking || effort === "max" || effort === "xhigh"

	return {
		...(isThinking ? { supportsReasoning: true } : {}),
		...(hasMillion ? { contextWindow: 1_000_000 } : {}),
		...(largeOutput ? { maxOutput: 65536 } : {}),
	}
}

/**
 * Discover models by running `cursor-agent --list-models` and parsing
 * its text output (cursor-agent has no `--json` flag as of April 2026).
 *
 * Format: `<id> - <name>  (optional trailing tag like "(default)")`.
 * Falls back to the hardcoded list on any failure so Loop still boots
 * when cursor-agent is missing.
 */
export async function discoverCursorModels(): Promise<ModelInfo[]> {
	const cmd = getCursorAgentCmd()

	// cursor-agent exposes two ways to list models: the `--list-models`
	// flag (newer) and the `models` subcommand (older). Try the flag
	// first, fall back to the subcommand, then to the hardcoded list.
	const attempts: string[][] = [
		[cmd, "--list-models"],
		[cmd, "models"],
	]

	for (const argv of attempts) {
		try {
			const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", timeout: 15_000 })
			const stdout = await new Response(proc.stdout).text()
			const exitCode = await proc.exited
			if (exitCode !== 0) continue

			const models: ModelInfo[] = []
			for (const line of stdout.split("\n")) {
				const match = line.match(/^(\S+)\s+-\s+(.+?)(?:\s+\(.*\))?\s*$/)
				if (!match) continue
				const [, id, rawName] = match
				const name = rawName.trim()
				models.push(model(id, name, inferModelCapabilities(id, name)))
			}

			if (models.length === 0) continue
			log.info("Discovered cursor models", { count: models.length, via: argv[1] })
			return models
		} catch (err) {
			log.debug("cursor-agent model discovery attempt failed", {
				argv: argv.join(" "),
				error: err instanceof Error ? err.message : String(err),
			})
		}
	}

	log.debug("All cursor-agent discovery attempts failed, using fallback")
	return FALLBACK_MODELS
}

export function isCursorModel(modelId: string): boolean {
	return cursorProvider.models.some((m) => m.id === modelId)
}

// ─── Provider Config ────────────────────────────────────────────

export const cursorProvider: ProviderConfig = {
	id: CURSOR_PROVIDER_ID,
	name: "Cursor",
	description: "Cursor editor subscription — use your Cursor Pro/Business plan models",
	npm: "@ai-sdk/openai-compatible",
	auth: { methods: ["oauth"], envKeys: [] },
	models: FALLBACK_MODELS,
	createModel(modelId: string, credentials: ProviderCredentials): LanguageModel {
		// baseUrl is required by @ai-sdk/openai-compatible but never used —
		// all requests are intercepted by customFetch and routed through cursor-agent.
		const creds = { ...credentials, baseUrl: credentials.baseUrl ?? "http://localhost:0/v1" }
		return createLanguageModel("@ai-sdk/openai-compatible", modelId, creds, CURSOR_PROVIDER_ID)
	},
}

// ─── Auth Handler ───────────────────────────────────────────────

export const cursorHandler: AuthHandler = {
	providerId: CURSOR_PROVIDER_ID,

	methods: [
		{
			id: "oauth-cursor",
			type: "oauth",
			label: "Sign in with Cursor",
			description: "Authenticate via Cursor editor account — requires cursor-agent CLI",
			prompts: [],
		},
	],

	async authorize(_methodId, _inputs = {}): Promise<AuthAuthorization> {
		const cmd = getCursorAgentCmd()
		log.info("Starting cursor-agent login")

		return new Promise((resolve, reject) => {
			const proc = spawn(cmd, ["login"], { stdio: ["pipe", "pipe", "pipe"] })

			let stdout = ""
			let stderr = ""
			let urlExtracted = false

			proc.stdout.on("data", (data: Buffer) => {
				stdout += data.toString()
			})
			proc.stderr.on("data", (data: Buffer) => {
				stderr += data.toString()
			})

			// Poll stdout for the login URL
			const startTime = Date.now()
			const pollForUrl = () => {
				if (urlExtracted) return

				if (Date.now() - startTime >= URL_EXTRACT_TIMEOUT) {
					proc.kill()
					reject(
						new Error(`Failed to get Cursor login URL: ${stderr ? stripAnsi(stderr) : "timeout"}`),
					)
					return
				}

				const clean = stripAnsi(stdout).replace(/\s/g, "")
				const match = clean.match(/https:\/\/cursor\.com\/loginDeepControl[^\s]*/)
				if (match && !urlExtracted) {
					urlExtracted = true
					const url = match[0]
					log.info("Got Cursor login URL")

					resolve({
						url,
						method: "auto",
						instructions: "Click 'Continue with Cursor' in your browser to authenticate.",
						async poll(): Promise<AuthResult> {
							return new Promise((resolve) => {
								let resolved = false
								const resolveOnce = (result: AuthResult) => {
									if (!resolved) {
										resolved = true
										resolve(result)
									}
								}

								proc.on("close", async (code) => {
									if (code === 0) {
										const found = await pollForAuthFile()
										if (found) {
											resolveOnce({
												type: "success",
												accessToken: "cursor-auth",
												refreshToken: "cursor-auth",
												expiresAt: 0, // cursor-agent manages token refresh
											})
										} else {
											resolveOnce({
												type: "failed",
												error: "Authentication was not completed. Please try again.",
											})
										}
									} else {
										resolveOnce({
											type: "failed",
											error: stderr
												? stripAnsi(stderr)
												: `cursor-agent login failed with code ${code}`,
										})
									}
								})

								setTimeout(() => {
									proc.kill()
									resolveOnce({
										type: "failed",
										error: "Authentication timed out. Please try again.",
									})
								}, AUTH_POLL_TIMEOUT)
							})
						},
					})
				}

				if (!urlExtracted) setTimeout(pollForUrl, 100)
			}

			pollForUrl()
		})
	},

	createFetch(
		_getAuth: () => Promise<OAuthAuth | undefined>,
		_setAuth: (auth: OAuthAuth) => Promise<void>,
	): typeof fetch {
		/**
		 * Custom fetch that intercepts OpenAI-compatible requests and routes
		 * them through cursor-agent. The agent handles auth internally using
		 * its own credential files.
		 */
		const cursorFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
			const url =
				input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url)

			// Model list endpoint — return our known models
			if (url.pathname.endsWith("/models") && (!init?.method || init.method === "GET")) {
				return Response.json({
					object: "list",
					data: cursorProvider.models.map((m: ModelInfo) => ({
						id: m.id,
						object: "model",
						created: 0,
						owned_by: "cursor",
					})),
				})
			}

			// Chat completions — route through cursor-agent
			if (url.pathname.endsWith("/chat/completions") && init?.method === "POST") {
				const body =
					typeof init.body === "string"
						? (JSON.parse(init.body) as {
								model?: string
								messages?: OpenAiMessage[]
								tools?: OpenAiTool[]
								stream?: boolean
							})
						: ({} as Record<string, never>)

				const model = body.model?.replace("cursor/", "") || "auto"
				const messages = (body.messages ?? []) as OpenAiMessage[]
				const tools = (body.tools ?? []) as OpenAiTool[]
				const allowedTools = extractAllowedToolNames(tools)

				// Root cursor-agent in Loop's current workspace so its tool
				// paths match Loop's workspace isolation. Falls back to cwd
				// if we're outside a workspace context (e.g. provider test).
				let workspace: string | null = null
				try {
					workspace = Workspace.dir()
				} catch {
					workspace = null
				}

				// Look up a prior cursor session for this conversation. On a
				// cache hit we --resume the stored session and send only the
				// messages added since the last turn, saving ~1-2s per call
				// on typical multi-step tool loops. On a miss (first turn,
				// TTL-expired, or just-invalidated) we spawn fresh with the
				// full transcript.
				const cacheKey = conversationKey(workspace, messages)
				const cached = getCachedSession(cacheKey)
				const resumeFrom = cached?.sessionId ?? null
				const startIdx = cached ? Math.min(cached.messagesSent, messages.length) : 0
				const deltaMessages = startIdx > 0 ? messages.slice(startIdx) : messages

				const prompt = buildCursorPrompt(deltaMessages, tools, { resume: !!resumeFrom })
				const stream = createCursorSseStream({
					prompt,
					model,
					allowedTools,
					signal: init.signal ?? null,
					workspace,
					resumeSessionId: resumeFrom,
					onTurnComplete: (info) => {
						// Invalidate on resume failure so the next turn spawns
						// fresh — cursor's server-side session may have expired.
						if (resumeFrom && info.errored) {
							invalidateCachedSession(cacheKey)
							return
						}
						if (info.sessionId) {
							setCachedSession(cacheKey, info.sessionId, messages.length)
						}
					},
				})

				if (body.stream !== false) {
					return new Response(stream, {
						headers: {
							"Content-Type": "text/event-stream",
							"Cache-Control": "no-cache",
							Connection: "keep-alive",
						},
					})
				}

				// Non-streaming: collapse the SSE stream into a single response.
				const reader = stream.getReader()
				const decoder = new TextDecoder()
				let content = ""
				const toolCalls: Array<{
					id: string
					type: "function"
					function: { name: string; arguments: string }
				}> = []
				let finishReason: string | null = null

				for (;;) {
					const { done, value } = await reader.read()
					if (done) break
					const text = decoder.decode(value, { stream: true })
					for (const line of text.split("\n")) {
						if (!line.startsWith("data: ") || line === "data: [DONE]") continue
						try {
							const chunk = JSON.parse(line.slice(6)) as {
								choices?: Array<{
									delta?: {
										content?: string
										tool_calls?: Array<{
											index: number
											id: string
											type: "function"
											function: { name: string; arguments: string }
										}>
									}
									finish_reason?: string | null
								}>
							}
							const delta = chunk.choices?.[0]?.delta
							if (delta?.content) content += delta.content
							if (delta?.tool_calls) {
								for (const tc of delta.tool_calls) {
									toolCalls.push({
										id: tc.id,
										type: "function",
										function: tc.function,
									})
								}
							}
							const reason = chunk.choices?.[0]?.finish_reason
							if (reason) finishReason = reason
						} catch {
							// skip malformed SSE frames
						}
					}
				}

				return Response.json({
					id: `cursor-${Date.now()}`,
					object: "chat.completion",
					created: Math.floor(Date.now() / 1000),
					model,
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: content || null,
								...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
							},
							finish_reason: finishReason ?? (toolCalls.length > 0 ? "tool_calls" : "stop"),
						},
					],
					usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
				})
			}

			// Fallback: pass through
			return fetch(input, init)
		}

		return cursorFetch as typeof fetch
	},
}
