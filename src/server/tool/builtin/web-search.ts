import { z } from "zod"
import type { Tool } from "../shape"

const EXA_MCP_URL = "https://mcp.exa.ai/mcp"
const EXA_TIMEOUT_MS = 25_000

/**
 * Search the web using Exa's MCP API.
 * Requires EXA_API_KEY environment variable.
 */
export const webSearchTool: Tool.Shape = {
	id: "web-search",
	init() {
		const currentYear = new Date().getFullYear()

		return {
			description: `Search the web for information using Exa search (${currentYear}). Returns relevant results with titles, URLs, and content snippets for the given query.`,
			parameters: z.object({
				query: z.string().describe("The search query"),
				numResults: z
					.number()
					.int()
					.min(1)
					.max(20)
					.optional()
					.describe("Number of results to return (default: 5, max: 20)"),
				livecrawl: z
					.enum(["always", "fallback", "never"])
					.optional()
					.describe(
						'Live crawl mode: "always" forces live crawl, "fallback" uses cache first, "never" uses cache only (default: "fallback")',
					),
				type: z
					.enum(["auto", "keyword", "neural"])
					.optional()
					.describe(
						'Search type: "auto" selects best mode, "keyword" for exact matches, "neural" for semantic search (default: "auto")',
					),
				contextMaxCharacters: z
					.number()
					.int()
					.optional()
					.describe("Maximum characters of context per result (default: 3000)"),
			}),
			async execute(ctx, input) {
				await ctx.ask({
					permission: "web-search",
					patterns: [input.query],
					always: ["*"],
					metadata: { reason: `Web search: ${input.query}` },
				})

				const apiKey = process.env.EXA_API_KEY
				if (!apiKey) {
					return {
						output:
							"Web search is not configured. Set the EXA_API_KEY environment variable to enable Exa search.",
					}
				}

				try {
					const results = await exaSearch({
						apiKey,
						query: input.query,
						numResults: input.numResults ?? 5,
						livecrawl: input.livecrawl ?? "fallback",
						type: input.type ?? "auto",
						contextMaxCharacters: input.contextMaxCharacters ?? 3000,
						signal: ctx.signal,
					})

					if (results.length === 0) {
						return { output: `No results found for: ${input.query}` }
					}

					const formatted = results
						.map((r, i) => {
							const lines = [`${i + 1}. ${r.title}`, `   URL: ${r.url}`]
							if (r.text) {
								lines.push(`   ${r.text}`)
							}
							return lines.join("\n")
						})
						.join("\n\n")

					return {
						output: formatted,
						metadata: { resultCount: results.length },
					}
				} catch (err) {
					return {
						output: `Search failed: ${err instanceof Error ? err.message : String(err)}`,
					}
				}
			},
		}
	},
}

// ── Exa MCP Client ──────────────────────────────────────────

interface ExaResult {
	title: string
	url: string
	text?: string
}

async function exaSearch(params: {
	apiKey: string
	query: string
	numResults: number
	livecrawl: string
	type: string
	contextMaxCharacters: number
	signal: AbortSignal
}): Promise<ExaResult[]> {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), EXA_TIMEOUT_MS)

	// Link parent signal
	const onParentAbort = () => controller.abort()
	params.signal.addEventListener("abort", onParentAbort, { once: true })

	try {
		// JSON-RPC 2.0 request to Exa MCP
		const rpcBody = {
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: {
				name: "web_search_exa",
				arguments: {
					query: params.query,
					numResults: params.numResults,
					livecrawl: params.livecrawl,
					type: params.type,
					textContentsOptions: JSON.stringify({
						maxCharacters: params.contextMaxCharacters,
					}),
				},
			},
		}

		const response = await fetch(EXA_MCP_URL, {
			method: "POST",
			signal: controller.signal,
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${params.apiKey}`,
			},
			body: JSON.stringify(rpcBody),
		})

		if (!response.ok) {
			throw new Error(`Exa API error: HTTP ${response.status} ${response.statusText}`)
		}

		const contentType = response.headers.get("content-type") ?? ""

		// Handle SSE responses
		if (contentType.includes("text/event-stream")) {
			return parseSSEResponse(response)
		}

		// Handle direct JSON responses
		const json = await response.json()
		return parseJsonRpcResult(json)
	} catch (err) {
		if (controller.signal.aborted && !params.signal.aborted) {
			throw new Error(`Search timed out after ${EXA_TIMEOUT_MS / 1000}s`)
		}
		throw err
	} finally {
		clearTimeout(timer)
		params.signal.removeEventListener("abort", onParentAbort)
	}
}

/** Parse an SSE response stream for the JSON-RPC result. */
async function parseSSEResponse(response: Response): Promise<ExaResult[]> {
	const text = await response.text()
	const lines = text.split("\n")

	for (const line of lines) {
		if (!line.startsWith("data: ")) continue
		const data = line.slice(6).trim()
		if (!data || data === "[DONE]") continue

		try {
			const json = JSON.parse(data)
			return parseJsonRpcResult(json)
		} catch {
			// Skip non-JSON data lines
		}
	}

	return []
}

/** Extract search results from a JSON-RPC 2.0 response. */
function parseJsonRpcResult(json: any): ExaResult[] {
	// JSON-RPC 2.0 result
	if (json.result) {
		const content = json.result.content
		if (Array.isArray(content)) {
			for (const item of content) {
				if (item.type === "text" && typeof item.text === "string") {
					return parseExaTextResult(item.text)
				}
			}
		}
		// Direct results array
		if (Array.isArray(json.result)) {
			return json.result.map(mapExaResult)
		}
	}

	// JSON-RPC 2.0 error
	if (json.error) {
		throw new Error(`Exa API error: ${json.error.message ?? JSON.stringify(json.error)}`)
	}

	return []
}

/** Parse the text content from Exa's response into structured results. */
function parseExaTextResult(text: string): ExaResult[] {
	try {
		const parsed = JSON.parse(text)
		if (Array.isArray(parsed)) {
			return parsed.map(mapExaResult)
		}
		if (parsed.results && Array.isArray(parsed.results)) {
			return parsed.results.map(mapExaResult)
		}
	} catch {
		// Not JSON — return as single text result
	}

	return [{ title: "Search Results", url: "", text }]
}

function mapExaResult(r: any): ExaResult {
	return {
		title: r.title ?? "Untitled",
		url: r.url ?? "",
		text: r.text ?? r.snippet ?? r.content ?? undefined,
	}
}
