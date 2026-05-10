/**
 * Strip a `data:<mime>;base64,` prefix from a string and return the raw
 * base64 payload. If the input is not a base64 data URL, it is returned
 * unchanged.
 */
export function stripDataUrlPrefix(content: string): string {
	const m = /^data:[^;]+;base64,(.+)$/.exec(content)
	if (m) return m[1]
	return content
}

/**
 * Heuristic for "this content is human-readable text we can inline as a
 * text block." Bare strings are assumed to be text; data URLs are only
 * considered text when their media type clearly is.
 */
export function looksLikeText(content: string): boolean {
	if (content.startsWith("data:")) {
		return /^data:(text\/|application\/(json|xml|yaml|x-yaml|toml))/.test(content)
	}
	return true
}

/**
 * Decode a `data:<text-mime>;base64,...` URL back into the original
 * UTF-8 text. Returns the raw input when it isn't a data URL (so callers
 * that already received plain text can pass strings through), or
 * `undefined` if the base64 payload fails to decode.
 *
 * Used by every runtime adapter (claude-code, cursor, opencode, AI-SDK)
 * so a code-selection submitted as `data:text/plain;base64,...` reaches
 * the model as actual source instead of an opaque base64 string. Without
 * this, the model sees gibberish for the new "Add to chat" feature.
 */
export function decodeDataUrlText(content: string): string | undefined {
	if (!content.startsWith("data:")) return content
	const commaIdx = content.indexOf(",")
	if (commaIdx === -1) return undefined
	const header = content.slice(0, commaIdx)
	const payload = content.slice(commaIdx + 1)
	if (!header.includes(";base64")) {
		// Plain (non-base64) data URL — payload is percent-encoded text.
		try {
			return decodeURIComponent(payload)
		} catch {
			return undefined
		}
	}
	try {
		// Anthropic, OpenAI, and OpenCode all run on Node/Bun where
		// Buffer.from(base64).toString("utf8") cleanly round-trips UTF-8;
		// `atob` works in browser-side tests too.
		if (typeof Buffer !== "undefined") {
			return Buffer.from(payload, "base64").toString("utf8")
		}
		const binary = atob(payload)
		const bytes = new Uint8Array(binary.length)
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
		return new TextDecoder("utf-8").decode(bytes)
	} catch {
		return undefined
	}
}
