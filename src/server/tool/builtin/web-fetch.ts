import TurndownService from "turndown"
import { z } from "zod"
import type { Tool } from "../shape"

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000

const CHROME_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
const HONEST_UA = "Loop/1.0 (Automated Tool)"

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp"])

/** Determine Accept header based on desired format. */
function acceptHeader(format: string): string {
	switch (format) {
		case "html":
			return "text/html;q=0.9, application/xhtml+xml;q=0.8, */*;q=0.1"
		case "text":
			return "text/plain;q=0.9, text/html;q=0.5, */*;q=0.1"
		default:
			return "text/html;q=0.9, application/xhtml+xml;q=0.8, text/plain;q=0.7, */*;q=0.1"
	}
}

/** Check if a URL points to an image based on extension. */
function isImageUrl(url: string): boolean {
	try {
		const pathname = new URL(url).pathname.toLowerCase()
		return IMAGE_EXTENSIONS.has(pathname.slice(pathname.lastIndexOf(".")))
	} catch {
		return false
	}
}

/** Strip script and style tags, then collapse whitespace. */
function extractText(html: string): string {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/<style[\s\S]*?<\/style>/gi, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ")
		.trim()
}

/** Convert HTML to markdown using Turndown. */
function htmlToMarkdown(html: string): string {
	const turndown = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
		bulletListMarker: "-",
	})
	return turndown.turndown(html)
}

/** Validate URL scheme. */
function validateUrl(url: string): void {
	const parsed = new URL(url)
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Unsupported URL scheme: ${parsed.protocol}. Only http and https are allowed.`)
	}
}

/** Check if a 403 response is from Cloudflare. */
function isCloudflareBlock(headers: Headers): boolean {
	const server = headers.get("server") ?? ""
	return server.toLowerCase().includes("cloudflare")
}

/** Fetch a URL and return its content. Supports multiple formats and retries. */
export const webFetchTool: Tool.Shape = {
	id: "web-fetch",
	init() {
		return {
			description:
				"Fetch the content of a URL. Returns the response body in the requested format. Supports HTML, plain text, and markdown (default) output. Can also fetch images and return base64-encoded content.",
			parameters: z.object({
				url: z.string().url().describe("The URL to fetch"),
				format: z
					.enum(["text", "markdown", "html"])
					.optional()
					.describe(
						'Output format: "text" strips all HTML, "markdown" (default) converts HTML to markdown, "html" returns raw HTML',
					),
				timeout: z
					.number()
					.optional()
					.describe(
						`Timeout in seconds (default: ${DEFAULT_TIMEOUT_MS / 1000}, max: ${MAX_TIMEOUT_MS / 1000})`,
					),
			}),
			async execute(ctx, input) {
				const format = input.format ?? "markdown"
				const timeoutMs = Math.min(
					(input.timeout ?? DEFAULT_TIMEOUT_MS / 1000) * 1000,
					MAX_TIMEOUT_MS,
				)

				await ctx.ask({
					permission: "web-fetch",
					patterns: [input.url],
					always: ["*"],
					metadata: { reason: `Fetch URL: ${input.url}` },
				})

				try {
					validateUrl(input.url)
				} catch (err) {
					return {
						output: err instanceof Error ? err.message : String(err),
					}
				}

				// Image detection: return base64
				if (isImageUrl(input.url)) {
					return fetchImage(input.url, timeoutMs, ctx.signal)
				}

				// First attempt with Chrome-like UA
				let response = await fetchWithUA(input.url, CHROME_UA, format, timeoutMs, ctx.signal)

				// Retry with honest UA on Cloudflare 403
				if (response.status === 403 && isCloudflareBlock(response.headers)) {
					response = await fetchWithUA(input.url, HONEST_UA, format, timeoutMs, ctx.signal)
				}

				if (!response.ok) {
					return {
						output: `HTTP ${response.status} ${response.statusText}`,
						metadata: { status: response.status },
					}
				}

				// Check content type for images in response
				const contentType = response.headers.get("content-type") ?? ""
				if (contentType.startsWith("image/")) {
					const buffer = await response.arrayBuffer()
					if (buffer.byteLength > MAX_RESPONSE_BYTES) {
						return {
							output: `Image too large: ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB (max ${MAX_RESPONSE_BYTES / 1024 / 1024}MB)`,
							metadata: { status: response.status },
						}
					}
					const base64 = Buffer.from(buffer).toString("base64")
					return {
						output: `data:${contentType};base64,${base64}`,
						metadata: {
							status: response.status,
							contentType,
							isImage: true,
							size: buffer.byteLength,
						},
					}
				}

				// Read text with size limit
				const buffer = await response.arrayBuffer()
				if (buffer.byteLength > MAX_RESPONSE_BYTES) {
					return {
						output: `Response too large: ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB (max ${MAX_RESPONSE_BYTES / 1024 / 1024}MB)`,
						metadata: { status: response.status, truncated: true },
					}
				}

				const text = new TextDecoder().decode(buffer)

				// Format the output
				const isHtml =
					contentType.includes("text/html") || contentType.includes("application/xhtml")

				let output: string
				if (format === "html" || !isHtml) {
					output = text
				} else if (format === "text") {
					output = extractText(text)
				} else {
					// markdown (default)
					output = htmlToMarkdown(text)
				}

				return {
					output,
					metadata: {
						status: response.status,
						contentType,
						format,
						originalSize: buffer.byteLength,
					},
				}
			},
		}
	},
}

// ── Helpers ──────────────────────────────────────────────────

async function fetchWithUA(
	url: string,
	userAgent: string,
	format: string,
	timeoutMs: number,
	signal: AbortSignal,
): Promise<Response> {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)

	// Link parent signal
	const onParentAbort = () => controller.abort()
	signal.addEventListener("abort", onParentAbort, { once: true })

	try {
		return await fetch(url, {
			signal: controller.signal,
			headers: {
				"User-Agent": userAgent,
				Accept: acceptHeader(format),
				"Accept-Language": "en-US,en;q=0.9",
			},
			redirect: "follow",
		})
	} catch (err) {
		if (controller.signal.aborted && !signal.aborted) {
			throw new Error(`Request timed out after ${timeoutMs / 1000}s`)
		}
		throw err
	} finally {
		clearTimeout(timer)
		signal.removeEventListener("abort", onParentAbort)
	}
}

async function fetchImage(
	url: string,
	timeoutMs: number,
	signal: AbortSignal,
): Promise<Tool.ToolResult> {
	try {
		const response = await fetchWithUA(url, CHROME_UA, "html", timeoutMs, signal)
		if (!response.ok) {
			return {
				output: `HTTP ${response.status} ${response.statusText}`,
				metadata: { status: response.status },
			}
		}

		const buffer = await response.arrayBuffer()
		if (buffer.byteLength > MAX_RESPONSE_BYTES) {
			return {
				output: `Image too large: ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB (max ${MAX_RESPONSE_BYTES / 1024 / 1024}MB)`,
				metadata: { status: response.status },
			}
		}

		const contentType = response.headers.get("content-type") ?? "image/png"
		const base64 = Buffer.from(buffer).toString("base64")
		return {
			output: `data:${contentType};base64,${base64}`,
			metadata: {
				status: response.status,
				contentType,
				isImage: true,
				size: buffer.byteLength,
			},
		}
	} catch (err) {
		return {
			output: `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
		}
	}
}
