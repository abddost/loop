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
