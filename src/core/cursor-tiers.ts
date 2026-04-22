/**
 * Cursor model tier detection and resolution.
 *
 * Cursor names models with a trailing **effort suffix** plus optional
 * `-fast` / `-thinking` modifiers (which can stack):
 *   `claude-opus-4-7-thinking-max`    → effort = max, thinking
 *   `gpt-5.1-codex-max-low`           → effort = low (codex-max is the family!)
 *   `gpt-5.4-xhigh-fast`              → effort = xhigh, fast
 *
 * Effort suffix ordering:  low < medium < high < xhigh < max
 *
 * Loop's UI exposes three quick-select tiers that map to the top of this
 * scale:
 *   - `auto`    → the literal model id "auto" (Cursor routes internally)
 *   - `premium` → effort == "high"
 *   - `max`     → effort == "max" (or "xhigh" when no true max variant exists)
 *
 * This is the single source of truth — both the client (model selector UI)
 * and the server (cursor provider capability inference) import from here.
 */

export type CursorTier = "auto" | "premium" | "max"

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
 * Detect which tier a model id explicitly belongs to. Returns `null`
 * for models without a tier-worthy effort suffix (composer-*, gpt-5.3-codex,
 * claude-4.6-sonnet-medium, etc.) so no button is highlighted unless the
 * user picked a tier shortcut or a model that clearly belongs to one.
 *
 * Uses trailing-suffix matching (not substring) so intermediate "max" in
 * family names like `gpt-5.1-codex-max-low` doesn't misclassify the model
 * — that id's effort is "low".
 */
export function detectTier(modelId: string): CursorTier | null {
	if (modelId === "auto") return "auto"
	const effort = getEffortSuffix(modelId)
	if (effort === "max") return "max"
	if (effort === "xhigh") return "max"
	if (effort === "high") return "premium"
	return null
}

// Family preference ranking (newest/most-capable first). Matched against
// model id substrings, so the order is load-bearing: earlier entries win.
const FAMILY_PREFERENCE: readonly string[] = [
	"claude-opus-4-7", // newest Claude as of April 2026
	"claude-4.7-opus",
	"claude-4.6-opus",
	"claude-opus-4-6",
	"claude-4.5-opus",
	"claude-opus-4-5",
	"gpt-5.4",
	"claude-4.6-sonnet",
	"gpt-5.3-codex",
	"gpt-5.3",
	"claude-4.5-sonnet",
	"gpt-5.2",
	"claude-4-sonnet",
	"gemini-3.1",
	"gemini-3",
	"grok-4",
	"composer-2",
	"composer",
	"kimi",
]

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

function pickByFamily<T extends { id: string }>(candidates: readonly T[]): T | null {
	if (candidates.length === 0) return null
	for (const family of FAMILY_PREFERENCE) {
		const match = candidates.find((c) => c.id.includes(family))
		if (match) return match
	}
	return candidates[0]
}

/**
 * Pick the best model id for a given tier from the available models.
 * Returns `null` if no models match (the button should be disabled).
 *
 * Tiebreakers:
 *   - `max` prefers true `-max` variants; if none, falls back to `-xhigh`.
 *   - `premium` prefers non-thinking variants (faster responses) when
 *     multiple family-equal candidates exist.
 *   - Within a tier, earlier entries in FAMILY_PREFERENCE win.
 */
export function resolveModelForTier(
	tier: CursorTier,
	models: ReadonlyArray<{ id: string }>,
): string | null {
	if (tier === "auto") {
		return models.some((m) => m.id === "auto") ? "auto" : null
	}

	if (tier === "max") {
		const maxCandidates = models.filter((m) => getEffortSuffix(m.id) === "max")
		if (maxCandidates.length > 0) return pickByFamily(maxCandidates)?.id ?? null
		const xhighCandidates = models.filter((m) => getEffortSuffix(m.id) === "xhigh")
		return pickByFamily(xhighCandidates)?.id ?? null
	}

	// premium
	const highCandidates = models.filter((m) => getEffortSuffix(m.id) === "high")
	if (highCandidates.length === 0) return null

	// Prefer non-thinking variants first (responsive UX), then fall back.
	const nonThinking = highCandidates.filter((m) => !m.id.includes("thinking"))
	const picked = pickByFamily(nonThinking) ?? pickByFamily(highCandidates)
	return picked?.id ?? null
}

/**
 * Given a currently-selected model id and a desired tier, find the
 * corresponding model in a different tier within the same family.
 * Used by the MAX Mode toggle to swap e.g. `claude-opus-4-7-high` ↔
 * `claude-opus-4-7-thinking-max` without losing the user's family choice.
 *
 * Returns `null` if no matching family+tier variant exists.
 */
export function findTierVariantInFamily(
	currentModelId: string,
	targetTier: CursorTier,
	models: ReadonlyArray<{ id: string }>,
): string | null {
	if (targetTier === "auto") {
		return models.some((m) => m.id === "auto") ? "auto" : null
	}
	const family = FAMILY_PREFERENCE.find((f) => currentModelId.includes(f))
	if (!family) return resolveModelForTier(targetTier, models)
	const familyModels = models.filter((m) => m.id.includes(family))
	return resolveModelForTier(targetTier, familyModels) ?? resolveModelForTier(targetTier, models)
}
