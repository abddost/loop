import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Deferred, pTimeout, sleep } from "@core/util/async"
import { assert, assertDefined } from "@core/util/assert"
import { ulid, descendingUlid } from "@core/id"
import {
	AppError,
	ProviderError,
	ToolError,
	ValidationError,
	WorkspaceError,
	isRetryable,
} from "@core/error"

// ─── Deferred ─────────────────────────────────────────────────

describe("Deferred", () => {
	it("resolves with a value", async () => {
		const d = new Deferred<number>()
		expect(d.settled).toBe(false)
		d.resolve(42)
		expect(d.settled).toBe(true)
		await expect(d.promise).resolves.toBe(42)
	})

	it("rejects with an error", async () => {
		const d = new Deferred<string>()
		expect(d.settled).toBe(false)
		d.reject(new Error("fail"))
		expect(d.settled).toBe(true)
		await expect(d.promise).rejects.toThrow("fail")
	})

	it("settled flag is initially false", () => {
		const d = new Deferred()
		expect(d.settled).toBe(false)
	})
})

// ─── pTimeout ─────────────────────────────────────────────────

describe("pTimeout", () => {
	it("resolves if promise completes within timeout", async () => {
		const result = await pTimeout(Promise.resolve(42), 1000)
		expect(result).toBe(42)
	})

	it("rejects if timeout is reached", async () => {
		const slow = new Promise<never>(() => {})
		await expect(pTimeout(slow, 10, "custom timeout")).rejects.toThrow("custom timeout")
	})

	it("uses default timeout message", async () => {
		const slow = new Promise<never>(() => {})
		await expect(pTimeout(slow, 10)).rejects.toThrow("Timed out after 10ms")
	})
})

// ─── sleep ────────────────────────────────────────────────────

describe("sleep", () => {
	it("resolves after the given duration", async () => {
		const start = Date.now()
		await sleep(50)
		const elapsed = Date.now() - start
		expect(elapsed).toBeGreaterThanOrEqual(40) // allow some timer imprecision
	})

	it("rejects immediately if signal is already aborted", async () => {
		const controller = new AbortController()
		controller.abort(new Error("pre-aborted"))
		await expect(sleep(1000, controller.signal)).rejects.toThrow("pre-aborted")
	})

	it("rejects when signal is aborted during sleep", async () => {
		const controller = new AbortController()
		const promise = sleep(5000, controller.signal)
		setTimeout(() => controller.abort(new Error("cancelled")), 10)
		await expect(promise).rejects.toThrow("cancelled")
	})
})

// ─── assert / assertDefined ───────────────────────────────────

describe("assert", () => {
	it("does not throw for truthy conditions", () => {
		expect(() => assert(true, "should not throw")).not.toThrow()
		expect(() => assert(1, "should not throw")).not.toThrow()
		expect(() => assert("non-empty", "should not throw")).not.toThrow()
	})

	it("throws AppError for falsy conditions", () => {
		expect(() => assert(false, "bad")).toThrow(AppError)
		expect(() => assert(false, "bad")).toThrow("bad")
		expect(() => assert(0, "zero")).toThrow("zero")
		expect(() => assert(null, "null")).toThrow("null")
		expect(() => assert(undefined, "undef")).toThrow("undef")
		expect(() => assert("", "empty")).toThrow("empty")
	})
})

describe("assertDefined", () => {
	it("returns value when defined", () => {
		expect(assertDefined(42, "msg")).toBe(42)
		expect(assertDefined("hello", "msg")).toBe("hello")
		expect(assertDefined(0, "msg")).toBe(0)
		expect(assertDefined("", "msg")).toBe("")
		expect(assertDefined(false, "msg")).toBe(false)
	})

	it("throws for undefined", () => {
		expect(() => assertDefined(undefined, "missing")).toThrow("missing")
	})

	it("throws for null", () => {
		expect(() => assertDefined(null, "missing")).toThrow("missing")
	})
})

// ─── ulid / descendingUlid ────────────────────────────────────

describe("ulid", () => {
	it("returns a string of length 26", () => {
		const id = ulid()
		expect(typeof id).toBe("string")
		expect(id).toHaveLength(26)
	})

	it("generates unique IDs", () => {
		const ids = new Set(Array.from({ length: 100 }, () => ulid()))
		expect(ids.size).toBe(100)
	})
})

describe("descendingUlid", () => {
	it("returns a string of length 26", () => {
		const id = descendingUlid()
		expect(typeof id).toBe("string")
		expect(id).toHaveLength(26)
	})

	it("generates time-descending IDs (newer sorts before older)", async () => {
		const first = descendingUlid()
		// Small delay to ensure different timestamps
		await new Promise((r) => setTimeout(r, 5))
		const second = descendingUlid()
		// Descending: newer (second) should sort BEFORE older (first)
		expect(second < first).toBe(true)
	})
})

// ─── Error classes ────────────────────────────────────────────

describe("Error classes", () => {
	describe("AppError", () => {
		it("creates with code and default statusCode", () => {
			const err = new AppError("test", { code: "TEST" })
			expect(err.message).toBe("test")
			expect(err.code).toBe("TEST")
			expect(err.statusCode).toBe(500)
			expect(err.name).toBe("AppError")
		})

		it("creates with custom statusCode", () => {
			const err = new AppError("not found", { code: "NOT_FOUND", statusCode: 404 })
			expect(err.statusCode).toBe(404)
		})

		it("creates with cause", () => {
			const cause = new Error("root cause")
			const err = new AppError("wrapped", { code: "WRAP", cause })
			expect(err.cause).toBe(cause)
		})
	})

	describe("ProviderError", () => {
		it("sets retryable and retryAfter", () => {
			const err = new ProviderError("rate limit", {
				code: "RATE_LIMIT",
				retryable: true,
				retryAfter: 5000,
			})
			expect(err.retryable).toBe(true)
			expect(err.retryAfter).toBe(5000)
			expect(err.name).toBe("ProviderError")
		})
	})

	describe("ToolError", () => {
		it("sets toolId", () => {
			const err = new ToolError("tool failed", { code: "TOOL_FAIL", toolId: "bash" })
			expect(err.toolId).toBe("bash")
			expect(err.name).toBe("ToolError")
		})
	})

	describe("ValidationError", () => {
		it("uses VALIDATION_ERROR code and 400 status", () => {
			const err = new ValidationError("bad input")
			expect(err.code).toBe("VALIDATION_ERROR")
			expect(err.statusCode).toBe(400)
			expect(err.name).toBe("ValidationError")
		})
	})

	describe("WorkspaceError", () => {
		it("uses default code and status", () => {
			const err = new WorkspaceError("ws error")
			expect(err.code).toBe("WORKSPACE_ERROR")
			expect(err.statusCode).toBe(500)
			expect(err.name).toBe("WorkspaceError")
		})

		it("accepts custom code and status", () => {
			const err = new WorkspaceError("ws error", { code: "CUSTOM", statusCode: 409 })
			expect(err.code).toBe("CUSTOM")
			expect(err.statusCode).toBe(409)
		})
	})
})

// ─── isRetryable ──────────────────────────────────────────────

describe("isRetryable", () => {
	it("returns true for retryable ProviderError", () => {
		const err = new ProviderError("rate limit", {
			code: "RATE_LIMIT",
			retryable: true,
		})
		expect(isRetryable(err)).toBe(true)
	})

	it("returns false for non-retryable ProviderError", () => {
		const err = new ProviderError("bad request", {
			code: "BAD_REQUEST",
			retryable: false,
		})
		expect(isRetryable(err)).toBe(false)
	})

	it("returns true for AppError with retryable status code (429)", () => {
		const err = new AppError("too many", { code: "RATE", statusCode: 429 })
		expect(isRetryable(err)).toBe(true)
	})

	it("returns true for AppError with retryable status code (500, 502, 503)", () => {
		for (const statusCode of [500, 502, 503]) {
			const err = new AppError("server error", { code: "ERR", statusCode })
			expect(isRetryable(err)).toBe(true)
		}
	})

	it("returns false for AppError with non-retryable status code (400)", () => {
		const err = new AppError("bad request", { code: "BAD", statusCode: 400 })
		expect(isRetryable(err)).toBe(false)
	})

	it("returns true for plain object with status 429", () => {
		expect(isRetryable({ status: 429 })).toBe(true)
	})

	it("returns true for plain object with statusCode 503", () => {
		expect(isRetryable({ statusCode: 503 })).toBe(true)
	})

	it("returns true for object with response.status", () => {
		expect(isRetryable({ response: { status: 502 } })).toBe(true)
	})

	it("returns false for non-retryable object", () => {
		expect(isRetryable({ status: 400 })).toBe(false)
	})

	it("returns false for null/undefined/string/number", () => {
		expect(isRetryable(null)).toBe(false)
		expect(isRetryable(undefined)).toBe(false)
		expect(isRetryable("error")).toBe(false)
		expect(isRetryable(42)).toBe(false)
	})
})
