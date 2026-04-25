/**
 * Cursor model helpers — family/effort inference used by the cursor provider
 * handler to group models in the UI and to read capabilities from a model id.
 *
 * Cursor names models with a trailing **effort suffix** plus optional
 * `-fast` / `-thinking` modifiers (which can stack):
 *   `claude-opus-4-7-thinking-max`    → effort = max, thinking
 *   `gpt-5.1-codex-max-low`           → effort = low (codex-max is the family!)
 *   `gpt-5.4-xhigh-fast`              → effort = xhigh, fast
 *
 * Effort suffix ordering:  low < medium < high < xhigh < max
 */

export const CURSOR_PROVIDER_ID = "cursor"

/** Strip trailing `-fast` / `-thinking` modifiers (in any combination). */
export function stripModelModifiers(id: string): string {
	let s = id
	for (let i = 0; i < 3; i++) {
		const next = s.replace(/-(fast|thinking)$/, "")
		if (next === s) break
		s = next
	}
	return s
}

/** Return the trailing effort suffix of a model id, or null if none. */
export function getEffortSuffix(modelId: string): string | null {
	const m = stripModelModifiers(modelId).match(/-(low|medium|high|xhigh|max|none)$/)
	return m ? m[1] : null
}

/**
 * Broader family buckets used for UI grouping (e.g. submenu sections).
 * Keys are matched against the full model id as substrings; the first
 * match wins. Order is load-bearing.
 */
const FAMILY_BUCKETS: ReadonlyArray<{ id: string; match: readonly string[] }> = [
	{ id: "claude-opus", match: ["opus"] },
	{ id: "claude-sonnet", match: ["sonnet"] },
	{ id: "claude-haiku", match: ["haiku"] },
	{ id: "gpt-codex", match: ["codex"] },
	{ id: "gpt", match: ["gpt-", "gpt5", "gpt4"] },
	{ id: "gemini", match: ["gemini"] },
	{ id: "grok", match: ["grok"] },
	{ id: "composer", match: ["composer"] },
	{ id: "kimi", match: ["kimi"] },
]

/**
 * Infer a coarse family bucket from a cursor model id, used for UI grouping.
 * Returns `null` for ids we don't recognize (including the literal "auto").
 */
export function inferFamily(modelId: string): string | null {
	if (modelId === "auto") return null
	const lower = modelId.toLowerCase()
	for (const bucket of FAMILY_BUCKETS) {
		if (bucket.match.some((m) => lower.includes(m))) return bucket.id
	}
	return null
}
