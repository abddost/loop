import { describe, expect, it } from "vitest"
import { _sessionModelInfoToLoopModelsForTesting as toLoopModels } from "../../server/provider/handlers/cursor"

/**
 * Defensive-shape tests for the ACP model probe parser. Cursor's
 * `availableModels` array does not strictly conform to the on-paper ACP
 * schema in some shipping versions — items can be undefined, lack `id`,
 * use camelCase synonyms, or wrap parameter values as bare strings. The
 * parser must skip the bad and lift the good without throwing.
 */

describe("sessionModelInfoToLoopModels (defensive parsing)", () => {
	it("returns [] for undefined / null / non-object items", () => {
		expect(toLoopModels(undefined)).toEqual([])
		expect(toLoopModels(null)).toEqual([])
		expect(toLoopModels("string-not-object")).toEqual([])
		expect(toLoopModels(42)).toEqual([])
	})

	it("returns [] when id is missing or empty", () => {
		expect(toLoopModels({})).toEqual([])
		expect(toLoopModels({ id: "" })).toEqual([])
		expect(toLoopModels({ id: "   " })).toEqual([])
	})

	it("accepts modelId / model_id as id synonyms", () => {
		const a = toLoopModels({ modelId: "demo-1" })
		expect(a).toHaveLength(1)
		expect(a[0].id).toBe("demo-1")

		const b = toLoopModels({ model_id: "demo-2" })
		expect(b[0].id).toBe("demo-2")
	})

	it("accepts displayName / label / name as label synonyms", () => {
		expect(toLoopModels({ id: "x", displayName: "X Display" })[0].name).toBe("X Display")
		expect(toLoopModels({ id: "x", label: "X Label" })[0].name).toBe("X Label")
	})

	it("emits one model when there are no parameters", () => {
		const out = toLoopModels({ id: "composer-2", displayName: "Composer 2" })
		expect(out).toHaveLength(1)
		expect(out[0].id).toBe("composer-2")
		expect(out[0].name).toBe("Composer 2")
	})

	it("expands parameter cartesian product with displayName labels", () => {
		const out = toLoopModels({
			id: "composer-2",
			displayName: "Composer 2",
			parameters: [
				{
					id: "fast",
					values: [
						{ value: "true", displayName: "Fast" },
						{ value: "false", displayName: "Normal" },
					],
				},
			],
		})
		expect(out).toHaveLength(2)
		expect(out.map((m) => m.id).sort()).toEqual(["composer-2:fast=false", "composer-2:fast=true"])
	})

	it("accepts string-only parameter values (no wrapping object)", () => {
		const out = toLoopModels({
			id: "x",
			parameters: [{ id: "mode", values: ["a", "b"] }],
		})
		expect(out).toHaveLength(2)
		expect(out.map((m) => m.id).sort()).toEqual(["x:mode=a", "x:mode=b"])
	})

	it("accepts options as a values-array synonym", () => {
		const out = toLoopModels({
			id: "x",
			parameters: [{ id: "mode", options: [{ value: "a" }, { value: "b" }] }],
		})
		expect(out).toHaveLength(2)
	})

	it("accepts params as a parameters-array synonym", () => {
		const out = toLoopModels({
			id: "x",
			params: [{ id: "mode", values: [{ value: "a" }] }],
		})
		expect(out).toHaveLength(1)
		expect(out[0].id).toBe("x:mode=a")
	})

	it("skips parameters that lack id or values", () => {
		const out = toLoopModels({
			id: "x",
			parameters: [
				{ values: [{ value: "v" }] }, // no id
				{ id: "okay" }, // no values
				{ id: "good", values: [{ value: "v1" }] },
			],
		})
		expect(out).toHaveLength(1)
		expect(out[0].id).toBe("x:good=v1")
	})

	it("caps cartesian explosion at 16 variants", () => {
		const fiveValues = Array.from({ length: 5 }, (_, i) => ({ value: `v${i}` }))
		const out = toLoopModels({
			id: "x",
			parameters: [
				{ id: "a", values: fiveValues },
				{ id: "b", values: fiveValues },
				{ id: "c", values: fiveValues }, // 5×5×5 = 125 raw; cap at 16
			],
		})
		expect(out.length).toBeLessThanOrEqual(16)
	})

	it("does not throw when parameters is malformed", () => {
		expect(() => toLoopModels({ id: "x", parameters: "not-an-array" })).not.toThrow()
		expect(() => toLoopModels({ id: "x", parameters: [null, undefined, 42] })).not.toThrow()
	})
})
