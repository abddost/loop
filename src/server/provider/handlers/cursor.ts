import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir, platform } from "node:os"
import { join } from "node:path"
import type { OAuthAuth } from "@core/schema/provider"
import type { LanguageModel } from "ai"
import { createLogger } from "../../logger"
import type { AuthAuthorization, AuthHandler, AuthResult } from "../auth-handler"
import type { ModelInfo, ProviderConfig, ProviderCredentials } from "../base"
import { createLanguageModel } from "../sdk"

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

// ─── ANSI Stripping ─────────────────────────────────────────────

// biome-ignore lint/suspicious/noControlCharactersInRegex: need to strip ANSI escape codes from cursor-agent output
const ANSI_RE = /[\u001B\u009B][#();?[]*(?:\d{1,4}(?:;\d{0,4})*)?[\d<=>A-ORZcf-nqry]/g

function stripAnsi(str: string): string {
	return str.replace(ANSI_RE, "")
}

// ─── Stream-JSON → OpenAI SSE Conversion ────────────────────────

/**
 * cursor-agent outputs NDJSON with these event types:
 *   { type: "assistant", message: { content: [{ type: "text", text: "..." }] }, timestamp_ms?: number }
 *   { type: "thinking", subtype: "delta", text: "...", timestamp_ms?: number }
 *   { type: "thinking", subtype: "completed" }
 *   { type: "tool_call", call_id: "...", tool_call: { toolName: { args: {...} } } }
 *   { type: "result", subtype: "success" | "error" }
 *
 * We convert these into OpenAI chat.completion.chunk SSE events.
 */

interface StreamJsonEvent {
	type: string
	subtype?: string
	timestamp_ms?: number
	text?: string
	call_id?: string
	tool_call?: Record<string, { args?: Record<string, unknown> }>
	message?: {
		content: Array<{ type: string; text?: string; thinking?: string }>
	}
	is_error?: boolean
	error?: { message?: string }
}

function extractText(event: StreamJsonEvent): string {
	if (!event.message?.content) return ""
	return event.message.content
		.filter((c) => c.type === "text")
		.map((c) => c.text ?? "")
		.join("")
}

function extractThinking(event: StreamJsonEvent): string {
	if (event.type === "thinking" && event.text) return event.text
	if (!event.message?.content) return ""
	return event.message.content
		.filter((c) => c.type === "thinking")
		.map((c) => c.thinking ?? "")
		.join("")
}

function formatSseChunk(payload: object): string {
	return `data: ${JSON.stringify(payload)}\n\n`
}

/**
 * Converts cursor-agent stream-json events to OpenAI SSE chunks.
 * Tracks delta vs accumulated text to avoid duplication.
 */
class StreamConverter {
	private id: string
	private created: number
	private model: string
	private lastText = ""
	private lastThinking = ""
	private sawTextPartials = false
	private sawThinkingPartials = false

	constructor(model: string) {
		this.model = model
		this.id = `cursor-${Date.now()}`
		this.created = Math.floor(Date.now() / 1000)
	}

	handle(event: StreamJsonEvent): string[] {
		const chunks: string[] = []

		if (event.type === "assistant" && event.message?.content.some((c) => c.type === "text")) {
			const isPartial = typeof event.timestamp_ms === "number"
			const text = extractText(event)
			if (isPartial) {
				this.sawTextPartials = true
				if (text) chunks.push(this.chunk({ content: text }))
			} else if (!this.sawTextPartials) {
				const delta = this.textDelta(text)
				if (delta) chunks.push(this.chunk({ content: delta }))
			}
		}

		if (
			event.type === "thinking" ||
			(event.type === "assistant" && event.message?.content.some((c) => c.type === "thinking"))
		) {
			const isPartial = typeof event.timestamp_ms === "number"
			const text = extractThinking(event)
			if (isPartial) {
				this.sawThinkingPartials = true
				if (text) chunks.push(this.chunk({ reasoning_content: text }))
			} else if (!this.sawThinkingPartials) {
				const delta = this.thinkingDelta(text)
				if (delta) chunks.push(this.chunk({ reasoning_content: delta }))
			}
		}

		if (event.type === "tool_call" && event.tool_call) {
			const toolKey = Object.keys(event.tool_call)[0]
			if (toolKey) {
				const args = event.tool_call[toolKey]?.args
				const name = toolKey.endsWith("ToolCall")
					? toolKey[0].toLowerCase() + toolKey.slice(1, -"ToolCall".length)
					: toolKey
				chunks.push(
					this.chunk({
						tool_calls: [
							{
								index: 0,
								id: event.call_id ?? "unknown",
								type: "function",
								function: { name, arguments: args ? JSON.stringify(args) : "" },
							},
						],
					}),
				)
			}
		}

		if (event.type === "result" && event.is_error && event.error?.message) {
			chunks.push(this.chunk({ content: `Error: ${event.error.message}` }))
		}

		return chunks
	}

	private chunk(delta: Record<string, unknown>): string {
		return formatSseChunk({
			id: this.id,
			object: "chat.completion.chunk",
			created: this.created,
			model: this.model,
			choices: [{ index: 0, delta, finish_reason: null }],
		})
	}

	private textDelta(accumulated: string): string {
		if (!accumulated) return ""
		const delta = accumulated.slice(this.lastText.length)
		this.lastText = accumulated
		return delta
	}

	private thinkingDelta(accumulated: string): string {
		if (!accumulated) return ""
		const delta = accumulated.slice(this.lastThinking.length)
		this.lastThinking = accumulated
		return delta
	}
}

// ─── cursor-agent Execution ─────────────────────────────────────

function getCursorAgentCmd(): string {
	return process.env.CURSOR_AGENT_EXECUTABLE || "cursor-agent"
}

/**
 * Spawn cursor-agent with a prompt on stdin, returning a ReadableStream<Uint8Array>
 * that emits OpenAI SSE-formatted chunks.
 */
function spawnCursorAgent(
	prompt: string,
	model: string,
	signal?: AbortSignal | null,
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder()
	const converter = new StreamConverter(model)

	return new ReadableStream({
		start(controller) {
			const cmd = getCursorAgentCmd()
			const args = [
				"--print",
				"--trust",
				"--output-format",
				"stream-json",
				"--stream-partial-output",
				"--model",
				model,
			]

			const proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] })

			let buffer = ""

			const cleanup = () => {
				if (!proc.killed) proc.kill()
			}

			signal?.addEventListener("abort", cleanup, { once: true })

			proc.stdout.on("data", (data: Buffer) => {
				buffer += data.toString()

				let newlineIdx: number
				// biome-ignore lint/suspicious/noAssignInExpressions: efficient NDJSON line splitting in streaming loop
				while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
					const line = buffer.slice(0, newlineIdx).trim()
					buffer = buffer.slice(newlineIdx + 1)

					if (!line) continue
					try {
						const event = JSON.parse(line) as StreamJsonEvent
						const chunks = converter.handle(event)
						for (const chunk of chunks) {
							controller.enqueue(encoder.encode(chunk))
						}
					} catch {
						log.debug("Failed to parse stream-json line", { line: line.slice(0, 100) })
					}
				}
			})

			proc.stderr.on("data", (data: Buffer) => {
				log.debug("cursor-agent stderr", { output: data.toString().slice(0, 200) })
			})

			proc.on("close", (code) => {
				// Flush remaining buffer
				if (buffer.trim()) {
					try {
						const event = JSON.parse(buffer.trim()) as StreamJsonEvent
						const chunks = converter.handle(event)
						for (const chunk of chunks) {
							controller.enqueue(encoder.encode(chunk))
						}
					} catch {
						// ignore
					}
				}

				// Send [DONE] sentinel
				controller.enqueue(encoder.encode("data: [DONE]\n\n"))
				controller.close()

				if (code !== 0 && code !== null) {
					log.warn("cursor-agent exited with non-zero code", { code })
				}

				signal?.removeEventListener("abort", cleanup)
			})

			proc.on("error", (err) => {
				log.error("cursor-agent spawn error", { error: err.message })
				controller.enqueue(
					encoder.encode(
						formatSseChunk({
							id: `cursor-err-${Date.now()}`,
							object: "chat.completion.chunk",
							created: Math.floor(Date.now() / 1000),
							model,
							choices: [
								{
									index: 0,
									delta: {
										content:
											"Error: cursor-agent not found. Install Cursor editor and ensure cursor-agent is in PATH.",
									},
									finish_reason: null,
								},
							],
						}),
					),
				)
				controller.enqueue(encoder.encode("data: [DONE]\n\n"))
				controller.close()

				signal?.removeEventListener("abort", cleanup)
			})

			// Send prompt via stdin
			proc.stdin.write(prompt)
			proc.stdin.end()
		},
	})
}

// ─── Models ─────────────────────────────────────────────────────

function model(id: string, name: string, opts: Partial<ModelInfo> = {}): ModelInfo {
	return {
		id,
		name,
		providerId: "cursor",
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
const large = { maxOutput: 32768 } as const
const million = { contextWindow: 1_000_000, maxOutput: 65536 } as const

/** Hardcoded fallback — used when `cursor-agent models` is unavailable. */
const FALLBACK_MODELS: ModelInfo[] = [
	model("auto", "Auto"),
	// Claude
	model("claude-4.6-opus-high-thinking", "Opus 4.6 1M Thinking", { ...thinking, ...million }),
	model("claude-4.6-opus-high", "Opus 4.6 1M", million),
	model("claude-4.6-opus-max-thinking", "Opus 4.6 1M Max Thinking", { ...thinking, ...million }),
	model("claude-4.6-sonnet-medium", "Sonnet 4.6 1M", million),
	model("claude-4.6-sonnet-medium-thinking", "Sonnet 4.6 1M Thinking", { ...thinking, ...million }),
	model("claude-4.5-opus-high-thinking", "Opus 4.5 Thinking", thinking),
	model("claude-4.5-sonnet", "Sonnet 4.5 1M", million),
	model("claude-4.5-sonnet-thinking", "Sonnet 4.5 1M Thinking", { ...thinking, ...million }),
	// GPT
	model("gpt-5.4-high", "GPT 5.4 1M High", million),
	model("gpt-5.4-medium", "GPT 5.4 1M", million),
	model("gpt-5.3-codex", "GPT 5.3 Codex", large),
	model("gpt-5.2", "GPT 5.2", large),
	// Gemini
	model("gemini-3.1-pro", "Gemini 3.1 Pro", million),
	model("gemini-3-pro", "Gemini 3 Pro", million),
	// Composer
	model("composer-2", "Composer 2"),
	// Grok
	model("grok-4-20", "Grok 4.20"),
	model("grok-4-20-thinking", "Grok 4.20 Thinking", thinking),
]

/**
 * Discover models by running `cursor-agent models` and parsing the text output.
 * Format: `<id> - <name>  (optional tag)`
 * Falls back to the hardcoded list on failure.
 */
export async function discoverCursorModels(): Promise<ModelInfo[]> {
	try {
		const proc = Bun.spawn([getCursorAgentCmd(), "models"], {
			stdout: "pipe",
			stderr: "pipe",
			timeout: 15_000,
		})

		const stdout = await new Response(proc.stdout).text()
		const exitCode = await proc.exited

		if (exitCode !== 0) throw new Error(`exit code ${exitCode}`)

		const models: ModelInfo[] = []
		for (const line of stdout.split("\n")) {
			const match = line.match(/^(\S+)\s+-\s+(.+?)(?:\s+\(.*\))?$/)
			if (!match) continue
			const [, id, name] = match
			const lower = id.toLowerCase()
			const isThinking = lower.includes("thinking")
			const isMillionCtx = lower.includes("1m") || name.includes("1M") || lower.includes("gemini")
			models.push(
				model(id, name.trim(), {
					...(isThinking && { supportsReasoning: true, maxOutput: 65536 }),
					...(isMillionCtx && { contextWindow: 1_000_000 }),
				}),
			)
		}

		if (models.length === 0) throw new Error("no models parsed")
		log.info("Discovered cursor models", { count: models.length })
		return models
	} catch (err) {
		log.debug("cursor-agent model discovery failed, using fallback", {
			error: err instanceof Error ? err.message : String(err),
		})
		return FALLBACK_MODELS
	}
}

export function isCursorModel(modelId: string): boolean {
	return cursorProvider.models.some((m) => m.id === modelId)
}

// ─── Provider Config ────────────────────────────────────────────

export const cursorProvider: ProviderConfig = {
	id: "cursor",
	name: "Cursor",
	description: "Cursor editor subscription — use your Cursor Pro/Business plan models",
	npm: "@ai-sdk/openai-compatible",
	auth: { methods: ["oauth"], envKeys: [] },
	models: FALLBACK_MODELS,
	createModel(modelId: string, credentials: ProviderCredentials): LanguageModel {
		// baseUrl is required by @ai-sdk/openai-compatible but never used —
		// all requests are intercepted by customFetch and routed through cursor-agent.
		const creds = { ...credentials, baseUrl: credentials.baseUrl ?? "http://localhost:0/v1" }
		return createLanguageModel("@ai-sdk/openai-compatible", modelId, creds, "cursor")
	},
}

// ─── Auth Handler ───────────────────────────────────────────────

export const cursorHandler: AuthHandler = {
	providerId: "cursor",

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
								messages?: Array<{ role?: string; content?: string }>
								stream?: boolean
							})
						: ({} as Record<string, never>)

				const model = body.model?.replace("cursor/", "") || "auto"
				const messages = body.messages ?? []

				// Flatten messages into a prompt for cursor-agent stdin
				const prompt = messages
					.map((m) => `${(m.role ?? "user").toUpperCase()}: ${m.content ?? ""}`)
					.join("\n\n")

				if (body.stream !== false) {
					// Streaming response
					const stream = spawnCursorAgent(prompt, model, init.signal)
					return new Response(stream, {
						headers: {
							"Content-Type": "text/event-stream",
							"Cache-Control": "no-cache",
							Connection: "keep-alive",
						},
					})
				}

				// Non-streaming: collect full response
				const stream = spawnCursorAgent(prompt, model, init.signal)
				const reader = stream.getReader()
				const decoder = new TextDecoder()
				let content = ""

				for (;;) {
					const { done, value } = await reader.read()
					if (done) break

					const text = decoder.decode(value, { stream: true })
					// Extract content from SSE chunks
					for (const line of text.split("\n")) {
						if (!line.startsWith("data: ") || line === "data: [DONE]") continue
						try {
							const chunk = JSON.parse(line.slice(6)) as {
								choices?: Array<{ delta?: { content?: string } }>
							}
							content += chunk.choices?.[0]?.delta?.content ?? ""
						} catch {
							// skip
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
							message: { role: "assistant", content },
							finish_reason: "stop",
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
