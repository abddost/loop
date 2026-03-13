import { ProviderError } from "@core/error"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { calculateDelay, DEFAULT_RETRY_CONFIG, withRetry } from "@server/provider/retry"

// ─── calculateDelay ───────────────────────────────────────────

describe("calculateDelay", () => {
	it("returns exponential backoff for attempt 0", () => {
		// With Math.random mocked to 0, jitter = 0
		vi.spyOn(Math, "random").mockReturnValue(0)
		const delay = calculateDelay(0, DEFAULT_RETRY_CONFIG)
		// baseDelay * 2^0 = 1000, jitter = 1000 * 0.2 * 0 = 0
		expect(delay).toBe(1000)
		vi.restoreAllMocks()
	})

	it("increases with attempt number", () => {
		vi.spyOn(Math, "random").mockReturnValue(0)
		const delay0 = calculateDelay(0, DEFAULT_RETRY_CONFIG)
		const delay1 = calculateDelay(1, DEFAULT_RETRY_CONFIG)
		const delay2 = calculateDelay(2, DEFAULT_RETRY_CONFIG)
		expect(delay1).toBeGreaterThan(delay0)
		expect(delay2).toBeGreaterThan(delay1)
		vi.restoreAllMocks()
	})

	it("respects maxDelay", () => {
		vi.spyOn(Math, "random").mockReturnValue(0)
		const delay = calculateDelay(20, { ...DEFAULT_RETRY_CONFIG, maxDelay: 5000 })
		// exponential would be huge but capped at maxDelay
		expect(delay).toBe(5000)
		vi.restoreAllMocks()
	})

	it("honors Retry-After-Ms header", () => {
		const headers = new Headers({ "retry-after-ms": "2500" })
		const delay = calculateDelay(0, DEFAULT_RETRY_CONFIG, headers)
		expect(delay).toBe(2500)
	})

	it("honors Retry-After header (seconds)", () => {
		const headers = new Headers({ "retry-after": "3" })
		const delay = calculateDelay(0, DEFAULT_RETRY_CONFIG, headers)
		expect(delay).toBe(3000)
	})

	it("prefers Retry-After-Ms over Retry-After", () => {
		const headers = new Headers({
			"retry-after-ms": "500",
			"retry-after": "10",
		})
		const delay = calculateDelay(0, DEFAULT_RETRY_CONFIG, headers)
		expect(delay).toBe(500)
	})
})

// ─── withRetry ────────────────────────────────────────────────

describe("withRetry", () => {
	it("returns result on first successful attempt", async () => {
		const controller = new AbortController()
		const fn = vi.fn().mockResolvedValue(42)
		const result = await withRetry(fn, controller.signal, DEFAULT_RETRY_CONFIG)
		expect(result).toBe(42)
		expect(fn).toHaveBeenCalledTimes(1)
	})

	it("retries on retryable error then succeeds", async () => {
		const controller = new AbortController()
		const retryableError = new ProviderError("rate limit", {
			code: "RATE_LIMIT",
			retryable: true,
			statusCode: 429,
		})
		const fn = vi
			.fn()
			.mockRejectedValueOnce(retryableError)
			.mockResolvedValue("success")

		const config = { ...DEFAULT_RETRY_CONFIG, baseDelay: 1, maxDelay: 10 }
		const result = await withRetry(fn, controller.signal, config)
		expect(result).toBe("success")
		expect(fn).toHaveBeenCalledTimes(2)
	})

	it("throws after all retries exhausted", async () => {
		const controller = new AbortController()
		const retryableError = new ProviderError("server error", {
			code: "SERVER_ERROR",
			retryable: true,
			statusCode: 500,
		})
		const fn = vi.fn().mockRejectedValue(retryableError)

		const config = { ...DEFAULT_RETRY_CONFIG, maxRetries: 2, baseDelay: 1, maxDelay: 10 }
		await expect(withRetry(fn, controller.signal, config)).rejects.toThrow("server error")
		// 1 initial + 2 retries = 3 total calls
		expect(fn).toHaveBeenCalledTimes(3)
	})

	it("throws immediately on non-retryable error", async () => {
		const controller = new AbortController()
		const nonRetryableError = new ProviderError("bad request", {
			code: "BAD_REQUEST",
			retryable: false,
			statusCode: 400,
		})
		const fn = vi.fn().mockRejectedValue(nonRetryableError)

		await expect(withRetry(fn, controller.signal, DEFAULT_RETRY_CONFIG)).rejects.toThrow(
			"bad request",
		)
		expect(fn).toHaveBeenCalledTimes(1)
	})

	it("throws AbortError when signal is already aborted", async () => {
		const controller = new AbortController()
		controller.abort()
		const fn = vi.fn().mockResolvedValue(42)

		await expect(
			withRetry(fn, controller.signal, DEFAULT_RETRY_CONFIG),
		).rejects.toThrow("Aborted")
	})

	it("calls onRetry callback before each retry", async () => {
		const controller = new AbortController()
		const retryableError = new ProviderError("retry", {
			code: "RETRY",
			retryable: true,
			statusCode: 429,
		})
		const fn = vi
			.fn()
			.mockRejectedValueOnce(retryableError)
			.mockRejectedValueOnce(retryableError)
			.mockResolvedValue("ok")

		const onRetry = vi.fn()
		const config = { ...DEFAULT_RETRY_CONFIG, baseDelay: 1, maxDelay: 10 }
		await withRetry(fn, controller.signal, config, onRetry)

		expect(onRetry).toHaveBeenCalledTimes(2)
		expect(onRetry).toHaveBeenCalledWith(1, expect.any(ProviderError), expect.any(Number))
		expect(onRetry).toHaveBeenCalledWith(2, expect.any(ProviderError), expect.any(Number))
	})

	it("does not retry DOMException AbortError", async () => {
		const controller = new AbortController()
		const abortError = new DOMException("Aborted", "AbortError")
		const fn = vi.fn().mockRejectedValue(abortError)

		await expect(withRetry(fn, controller.signal, DEFAULT_RETRY_CONFIG)).rejects.toThrow(
			"Aborted",
		)
		expect(fn).toHaveBeenCalledTimes(1)
	})
})

// ─── ProviderRegistry ─────────────────────────────────────────

describe("ProviderRegistry", () => {
	// The registry is now loaded from models-dev snapshot data.
	// We need to call loadModelsDevCache() + loadFromModelsDev() for it to have providers.

	it("loads providers from models-dev snapshot", async () => {
		const { ProviderRegistry } = await import("@server/provider/registry")
		const { loadModelsDevCache, getModelsDevData } = await import("@server/provider/models-dev")

		loadModelsDevCache()
		ProviderRegistry.loadFromModelsDev(getModelsDevData())

		const list = ProviderRegistry.listWithStatus()
		expect(list.length).toBeGreaterThan(0)

		const anthropic = list.find((p) => p.id === "anthropic")
		expect(anthropic).toBeDefined()
		expect(anthropic!.name).toBe("Anthropic")
		expect(anthropic!.models.length).toBeGreaterThan(0)
	})

	it("getModelInfo returns model info for known model", async () => {
		const { ProviderRegistry } = await import("@server/provider/registry")
		const info = ProviderRegistry.getModelInfo("anthropic", "claude-sonnet-4-5")
		expect(info).toBeDefined()
		expect(info!.id).toBe("claude-sonnet-4-5")
		expect(info!.supportsTools).toBe(true)
	})

	it("getModelInfo returns undefined for unknown model", async () => {
		const { ProviderRegistry } = await import("@server/provider/registry")
		expect(ProviderRegistry.getModelInfo("anthropic", "nonexistent")).toBeUndefined()
	})

	it("getModelInfo returns undefined for unknown provider", async () => {
		const { ProviderRegistry } = await import("@server/provider/registry")
		expect(ProviderRegistry.getModelInfo("nonexistent", "model")).toBeUndefined()
	})

	it("resolveModel throws for missing provider", async () => {
		const { ProviderRegistry } = await import("@server/provider/registry")
		expect(() => ProviderRegistry.resolveModel("nonexistent", "model")).toThrow(
			'Provider "nonexistent" not found',
		)
	})

	it("resolveModel throws for missing model", async () => {
		const { ProviderRegistry } = await import("@server/provider/registry")
		expect(() => ProviderRegistry.resolveModel("anthropic", "nonexistent")).toThrow(
			'Model "nonexistent" not found',
		)
	})

	it("resolveModel throws for missing credentials", async () => {
		const { ProviderRegistry } = await import("@server/provider/registry")
		// Without AuthManager set, resolveModel should throw
		const originalKey = process.env.ANTHROPIC_API_KEY
		delete process.env.ANTHROPIC_API_KEY
		try {
			expect(() =>
				ProviderRegistry.resolveModel("anthropic", "claude-sonnet-4-5"),
			).toThrow("No credentials configured")
		} finally {
			if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey
		}
	})

	it("listCategorized returns categorized providers", async () => {
		const { ProviderRegistry } = await import("@server/provider/registry")
		const { connected, popular, other } = ProviderRegistry.listCategorized()

		// Without auth, all providers should be in popular or other
		expect(connected).toHaveLength(0)
		expect(popular.length + other.length).toBeGreaterThan(0)

		// Anthropic should be in popular
		const anthropicInPopular = popular.find((p) => p.id === "anthropic")
		expect(anthropicInPopular).toBeDefined()
	})

	it("model info includes enriched fields", async () => {
		const { ProviderRegistry } = await import("@server/provider/registry")
		const info = ProviderRegistry.getModelInfo("anthropic", "claude-opus-4-6")
		expect(info).toBeDefined()
		expect(info!.pricing.cacheRead).toBeGreaterThan(0)
		expect(info!.pricing.cacheWrite).toBeGreaterThan(0)
		expect(info!.modalities.input).toContain("text")
		expect(info!.family).toBeDefined()
	})
})
