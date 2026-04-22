import type { CursorTier } from "@core/cursor-tiers"

export {
	type CursorTier,
	CURSOR_PROVIDER_ID,
	detectTier,
	findTierVariantInFamily,
	resolveModelForTier,
} from "@core/cursor-tiers"

export const CURSOR_MODES: ReadonlyArray<{
	tier: CursorTier
	label: string
	hint: string
}> = [
	{ tier: "auto", label: "Auto", hint: "Efficiency" },
	{ tier: "premium", label: "Premium", hint: "Intelligence" },
	{ tier: "max", label: "MAX", hint: "Maximum" },
]
