import type { ModelInfo } from "@core/schema/provider"
import type { ModelMessage } from "ai"

/**
 * Lightweight message transform module for provider-specific quirks.
 *
 * Handles:
 * 1. Tool call ID sanitization (Anthropic: alphanumeric + dash/underscore only)
 * 2. Empty content message removal (Anthropic rejects empty strings)
 * 3. Prompt caching headers for Anthropic-family providers
 * 4. Provider-specific temperature defaults
 */
export namespace ProviderTransform {
	/**
	 * Apply all message transforms for the given provider/model.
	 */
	export function messages(msgs: ModelMessage[], info: ModelInfo, npm: string): ModelMessage[] {
		let result = removeEmptyContent(msgs, npm)
		result = sanitizeToolCallIds(result, info, npm)
		result = applyCaching(result, info, npm)
		return result
	}

	/**
	 * Return provider-appropriate temperature.
	 * - Anthropic Claude: undefined (let SDK use its own default)
	 * - Google Gemini: 1.0
	 * - All others: undefined (use SDK default)
	 */
	export function temperature(info: ModelInfo): number | undefined {
		const id = info.id.toLowerCase()
		if (id.includes("claude")) return undefined
		if (id.includes("gemini")) return 1.0
		return undefined
	}

	// ─── Private Transforms ──────────────────────────────────────

	/**
	 * Anthropic rejects messages with empty content strings.
	 * Filter out empty text messages and empty text parts.
	 */
	function removeEmptyContent(msgs: ModelMessage[], npm: string): ModelMessage[] {
		if (npm !== "@ai-sdk/anthropic") return msgs

		return msgs
			.map((msg) => {
				if (typeof msg.content === "string") {
					if (msg.content === "") return undefined
					return msg
				}
				if (!Array.isArray(msg.content)) return msg

				const filtered = msg.content.filter((part) => {
					if (part.type === "text") return part.text !== ""
					return true
				})
				if (filtered.length === 0) return undefined
				return { ...msg, content: filtered }
			})
			.filter((msg): msg is ModelMessage => msg !== undefined)
	}

	/**
	 * Anthropic requires tool call IDs to be alphanumeric + dash/underscore.
	 * Replace invalid characters with underscores.
	 */
	function sanitizeToolCallIds(msgs: ModelMessage[], info: ModelInfo, npm: string): ModelMessage[] {
		const isAnthropic = npm === "@ai-sdk/anthropic" || info.id.includes("claude")
		if (!isAnthropic) return msgs

		return msgs.map((msg) => {
			if ((msg.role === "assistant" || msg.role === "tool") && Array.isArray(msg.content)) {
				return {
					...msg,
					content: msg.content.map((part) => {
						if (
							(part.type === "tool-call" || part.type === "tool-result") &&
							"toolCallId" in part
						) {
							return {
								...part,
								toolCallId: part.toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_"),
							}
						}
						return part
					}),
				} as typeof msg
			}
			return msg
		})
	}

	/**
	 * Apply prompt caching headers for Anthropic-family providers.
	 * Marks system messages and the last 2 non-system messages for caching.
	 */
	function applyCaching(msgs: ModelMessage[], info: ModelInfo, npm: string): ModelMessage[] {
		const isAnthropic =
			npm === "@ai-sdk/anthropic" || info.id.includes("claude") || info.id.includes("anthropic")
		if (!isAnthropic) return msgs

		const cacheOptions = {
			anthropic: {
				cacheControl: { type: "ephemeral" },
			},
		}

		const system = msgs.filter((msg) => msg.role === "system").slice(0, 2)
		const nonSystem = msgs.filter((msg) => msg.role !== "system")
		const tail = nonSystem.slice(-2)

		const toMark = new Set([...system, ...tail])

		for (const msg of toMark) {
			msg.providerOptions = {
				...msg.providerOptions,
				...cacheOptions,
			}
		}

		return msgs
	}
}
