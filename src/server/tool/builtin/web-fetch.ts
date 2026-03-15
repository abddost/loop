import { z } from "zod"
import type { Tool } from "../shape"

/** Fetch a URL and return its content. Requires permission. */
export const webFetchTool: Tool.Shape = {
	id: "web-fetch",
	init() {
		return {
			description:
				"Fetch the content of a URL. Returns the response body as text. Useful for reading documentation, APIs, or web pages.",
			parameters: z.object({
				url: z.string().url().describe("The URL to fetch"),
			}),
			async execute(ctx, input) {
				await ctx.ask({
					permission: "web-fetch",
					patterns: [input.url],
					always: ["*"],
					metadata: { reason: `Fetch URL: ${input.url}` },
				})

				try {
					const response = await fetch(input.url, {
						signal: ctx.signal,
						headers: {
							"User-Agent": "Loop/1.0",
						},
					})

					if (!response.ok) {
						return {
							output: `HTTP ${response.status} ${response.statusText}`,
							metadata: { status: response.status },
						}
					}

					const text = await response.text()

					// Truncate very large responses
					const maxLength = 100_000
					const truncated = text.length > maxLength
					const output = truncated ? `${text.slice(0, maxLength)}\n...[truncated]` : text

					return {
						output,
						metadata: {
							status: response.status,
							contentType: response.headers.get("content-type"),
							truncated,
						},
					}
				} catch (err) {
					return {
						output: `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
					}
				}
			},
		}
	},
}
