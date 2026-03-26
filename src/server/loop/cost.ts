import type { StepUsage } from "./stream-processor"

export interface Pricing {
	input: number
	output: number
	cacheRead: number
	cacheWrite: number
}

/** Compute dollar cost for a single step from token usage and per-1M-token pricing. */
export function computeStepCost(usage: StepUsage, pricing: Pricing): number {
	return (
		(usage.input * pricing.input +
			usage.output * pricing.output +
			(usage.cacheRead ?? 0) * pricing.cacheRead +
			(usage.cacheWrite ?? 0) * pricing.cacheWrite) /
		1_000_000
	)
}
