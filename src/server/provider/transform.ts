import type { ModelInfo } from "@core/schema/provider"
import type { ModelMessage } from "ai"

/**
 * Message transform module for provider-specific quirks and model capability enforcement.
 *
 * Handles:
 * 1. Unsupported modality filtering (images to text-only models, etc.)
 * 2. Empty/corrupted image detection
 * 3. Tool call ID sanitization (Anthropic: alphanumeric + dash/underscore only)
 * 4. Empty content message removal (Anthropic rejects empty strings)
 * 5. Prompt caching headers for Anthropic-family providers
 * 6. Provider-specific temperature defaults
 */
export namespace ProviderTransform {
	/**
	 * Apply all message transforms for the given provider/model.
	 */
	export function messages(msgs: ModelMessage[], info: ModelInfo, npm: string): ModelMessage[] {
		let result = filterUnsupportedParts(msgs, info)
		result = removeEmptyContent(result, npm)
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

	function mimeToModality(mime: string): string | undefined {
		if (mime.startsWith("image/")) return "image"
		if (mime.startsWith("audio/")) return "audio"
		if (mime.startsWith("video/")) return "video"
		if (mime === "application/pdf") return "pdf"
		return undefined
	}

	/**
	 * Replace image/file parts with error text when the model doesn't support
	 * the required modality. Also catches empty/corrupted base64 images.
	 */
	function filterUnsupportedParts(msgs: ModelMessage[], info: ModelInfo): ModelMessage[] {
		const inputModalities = new Set(info.modalities?.input ?? ["text"])

		return msgs.map((msg) => {
			if (msg.role !== "user" || !Array.isArray(msg.content)) return msg

			const filtered = msg.content.map((part) => {
				if (part.type === "image") {
					const imageStr = typeof part.image === "string" ? part.image : ""
					if (!imageStr || imageStr.length === 0) {
						return {
							type: "text" as const,
							text: "ERROR: Image file is empty or corrupted. Inform the user that the image could not be loaded.",
						}
					}
					if (!info.supportsImages || !inputModalities.has("image")) {
						return {
							type: "text" as const,
							text: `ERROR: Cannot display image — model "${info.name}" does not support image input. Inform the user.`,
						}
					}
					return part
				}

				if (part.type === "file") {
					const mime = ("mediaType" in part ? (part.mediaType as string) : "") ?? ""
					const modality = mimeToModality(mime)
					if (modality && !inputModalities.has(modality)) {
						const name = "filename" in part ? (part.filename as string) : "file"
						return {
							type: "text" as const,
							text: `ERROR: Cannot process ${name ?? "file"} — model "${info.name}" does not support ${modality} input. Inform the user.`,
						}
					}
					return part
				}

				return part
			})

			return { ...msg, content: filtered }
		})
	}

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
	 * Apply prompt caching hints to system messages and the last 2 conversation messages.
	 *
	 * Provider coverage:
	 * - Anthropic (native):  message-level `cacheControl: { type: "ephemeral" }`
	 * - Bedrock (AWS Claude): message-level `cachePoint: { type: "default" }` (different key)
	 * - OpenRouter:           content-part-level `cacheControl` for non-Anthropic-native routing
	 *
	 * Only the first 2 system messages and last 2 non-system messages are marked to stay
	 * within Anthropic's 4-breakpoint limit.
	 */
	function applyCaching(msgs: ModelMessage[], info: ModelInfo, npm: string): ModelMessage[] {
		const isAnthropic =
			npm === "@ai-sdk/anthropic" || info.id.includes("claude") || info.id.includes("anthropic")
		const isBedrock = npm.includes("bedrock") || info.providerId === "bedrock"
		const isOpenRouter =
			npm.includes("openrouter") ||
			info.providerId === "openrouter" ||
			npm === "@openrouter/ai-sdk-provider"

		if (!isAnthropic && !isBedrock && !isOpenRouter) return msgs

		const system = msgs.filter((msg) => msg.role === "system").slice(0, 2)
		const nonSystem = msgs.filter((msg) => msg.role !== "system")
		const tail = nonSystem.slice(-2)
		const toMark = new Set([...system, ...tail])

		if (isBedrock) {
			// Bedrock uses cachePoint instead of cacheControl
			const bedrockOptions = { bedrock: { cachePoint: { type: "default" } } }
			for (const msg of toMark) {
				msg.providerOptions = { ...msg.providerOptions, ...bedrockOptions }
			}
			return msgs
		}

		if (isOpenRouter) {
			// OpenRouter requires cache hints at the content-part level for non-native routing
			const openrouterCacheControl = { cacheControl: { type: "ephemeral" } }
			for (const msg of toMark) {
				if (Array.isArray(msg.content) && msg.content.length > 0) {
					const lastPart = msg.content[msg.content.length - 1]
					if (lastPart && typeof lastPart === "object") {
						const part = lastPart as Record<string, unknown>
						const existing =
							part.providerOptions != null &&
							typeof part.providerOptions === "object"
								? (part.providerOptions as Record<string, unknown>)
								: {}
						part.providerOptions = { ...existing, openrouter: openrouterCacheControl }
					}
				} else {
					msg.providerOptions = {
						...msg.providerOptions,
						openrouter: openrouterCacheControl,
					}
				}
			}
			return msgs
		}

		// Anthropic native: message-level cache_control
		const anthropicOptions = { anthropic: { cacheControl: { type: "ephemeral" } } }
		for (const msg of toMark) {
			msg.providerOptions = { ...msg.providerOptions, ...anthropicOptions }
		}

		return msgs
	}

	/**
	 * Build provider-specific top-level providerOptions for session-level prompt caching.
	 * These complement the message-level cache breakpoints from applyCaching.
	 *
	 * - OpenAI: `promptCacheKey` enables automatic prefix caching for stable prompt prefixes.
	 * - OpenRouter: `prompt_cache_key` for session-scoped KV cache.
	 * - Venice: `promptCacheKey` for their OpenAI-compatible endpoint.
	 *
	 * Returns an empty object for providers that don't support session-level caching
	 * (e.g. Anthropic, which uses message-level cache_control instead).
	 */
	export function sessionCacheOptions(
		info: ModelInfo,
		npm: string,
		sessionId: string,
	): Record<string, unknown> {
		if (npm === "@ai-sdk/openai" || npm === "@ai-sdk/openai-compatible") {
			return { openai: { promptCacheKey: sessionId } }
		}
		if (
			npm.includes("openrouter") ||
			info.providerId === "openrouter" ||
			npm === "@openrouter/ai-sdk-provider"
		) {
			return { openrouter: { prompt_cache_key: sessionId } }
		}
		if (info.providerId === "venice") {
			return { venice: { promptCacheKey: sessionId } }
		}
		return {}
	}
}
