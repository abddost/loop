import { z } from "zod"
import type { Tool } from "../shape"

/** Placeholder web search tool. Requires search API configuration to function. */
export const webSearchTool: Tool.Shape = {
	id: "web-search",
	init() {
		return {
			description: "Search the web for information. Returns relevant results for the given query.",
			parameters: z.object({
				query: z.string().describe("The search query"),
			}),
			async execute(_ctx, _input) {
				return {
					output:
						"Web search is not yet configured. Please set up a search API provider in your project settings.",
				}
			},
		}
	},
}
