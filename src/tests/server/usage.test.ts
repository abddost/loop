import { buildComparison } from "@server/loop/usage"
import { describe, expect, it } from "vitest"

describe("buildComparison", () => {
	it("returns undefined when no tokens have been used", () => {
		expect(buildComparison(0)).toBeUndefined()
	})

	it("returns undefined when below the 2× threshold of the smallest book", () => {
		// Animal Farm = 39_000 tokens; under 2× that = no comparison.
		expect(buildComparison(50_000)).toBeUndefined()
	})

	it("uses Animal Farm as the comparison for small token counts", () => {
		const result = buildComparison(100_000)
		expect(result).toContain("Animal Farm")
		expect(result).toMatch(/~\d+×/)
	})

	it("escalates to larger books as token counts grow", () => {
		// 5M tokens → War and Peace (750k tokens × 6+) is the largest book
		// the user has surpassed by 2×.
		const result = buildComparison(5_000_000)
		expect(result).toContain("War and Peace")
	})

	it("formats the multiplier with thousands separators for large ratios", () => {
		const result = buildComparison(48_000_000)
		// 48M / 750k = ~64x War and Peace
		expect(result).toMatch(/~\d+×/)
	})
})
