/**
 * Cursor model tier detection and resolution.
 *
 * Cursor exposes 80+ models with naming patterns that encode quality tiers:
 *   - "auto"              → auto-select (efficiency)
 *   - "-high" suffix      → premium / intelligence tier
 *   - "-max" / "-xhigh"   → maximum capability tier
 *   - everything else      → no explicit tier (user picked a specific model)
 *
 * This module maps those patterns to user-facing mode buttons.
 */

export type CursorTier = "auto" | "premium" | "max"

export const CURSOR_PROVIDER_ID = "cursor"

export const CURSOR_MODES: ReadonlyArray<{
	tier: CursorTier
	label: string
	hint: string
}> = [
	{ tier: "auto", label: "Auto", hint: "Efficiency" },
	{ tier: "premium", label: "Premium", hint: "Intelligence" },
	{ tier: "max", label: "MAX", hint: "Maximum" },
]

/**
 * Detect which tier a model ID explicitly belongs to.
 * Returns `null` for models that don't map to a mode button
 * (e.g. `composer-2`, `gpt-5.3-codex`, `claude-4.6-sonnet-medium`).
 * This ensures no mode is highlighted unless the user picked a tier shortcut
 * or a model that clearly belongs to one.
 */
export function detectTier(modelId: string): CursorTier | null {
	if (modelId === "auto") return "auto"
	if (modelId.includes("-max") || modelId.includes("-xhigh")) return "max"
	if (modelId.includes("-high")) return "premium"
	return null
}

/**
 * Classify a model for resolution purposes (which tier bucket it falls into).
 * Unlike `detectTier`, this always returns a tier — models without an explicit
 * tier suffix are bucketed into "auto" so the Auto button can resolve them.
 */
function classifyForResolution(modelId: string): CursorTier {
	if (modelId === "auto") return "auto"
	if (modelId.includes("-max") || modelId.includes("-xhigh")) return "max"
	if (modelId.includes("-high")) return "premium"
	return "auto"
}

// Preference ranking for model selection within a tier.
// Earlier entries are preferred. Matched against model ID substrings.
const MODEL_PREFERENCE = ["opus", "gpt-5.4", "gpt-5.3", "gpt-5.2", "gemini", "composer", "grok"]

/**
 * Pick the best model ID for a given tier from the available models.
 * Returns `null` if no models match (button should be disabled).
 */
export function resolveModelForTier(
	tier: CursorTier,
	models: ReadonlyArray<{ id: string }>,
): string | null {
	const candidates = models.filter((m) => classifyForResolution(m.id) === tier)
	if (candidates.length === 0) return null
	if (tier === "auto") return "auto"

	// Rank by preference
	for (const pref of MODEL_PREFERENCE) {
		const match = candidates.find((m) => m.id.includes(pref))
		if (match) return match.id
	}

	return candidates[0].id
}
