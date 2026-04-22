import type { ModelInfo } from "@core/schema/provider"

/**
 * The provider ID for Claude Code CLI.
 *
 * Kept in a shared constant so the dispatcher, registry, and frontend picker
 * all reference the same string.
 */
export const CLAUDE_CODE_PROVIDER_ID = "claude-code"

/**
 * Human-readable name shown in the model picker and settings.
 */
export const CLAUDE_CODE_PROVIDER_NAME = "Claude"

export const CLAUDE_CODE_PROVIDER_DESCRIPTION =
	"Route prompts through your local Claude Code CLI — uses your own subscription and runs Claude Code's built-in tools."

// ── Constants ────────────────────────────────────────────────────

const CONTEXT_200K = 200_000
const CONTEXT_1M = 1_000_000
const MAX_OUTPUT = 16_384
const zeroPricing = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

/**
 * Effort levels supported by Claude Code models (via the SDK `effort` option).
 * These are the exact values the SDK accepts: "low" | "medium" | "high" | "max".
 * "ultrathink" is prompt-injected (not an API parameter).
 */
const REASONING_EFFORT = ["low", "medium", "high", "max"] as const
const PROMPT_INJECTED_EFFORT = ["ultrathink"] as const
const DEFAULT_EFFORT = "high"

/** Effort levels for non-reasoning models (no "max", no "ultrathink"). */
const BASIC_EFFORT = ["low", "medium", "high"] as const

/**
 * Suffix appended to model IDs that use 1M context window.
 * Used by resolveApiModelId to produce the SDK format `model[1m]`.
 */
const CONTEXT_1M_SUFFIX = "-1m"

// ── Model catalog ────────────────────────────────────────────────

/**
 * Model catalog exposed by the Claude Code provider.
 *
 * Models that support multiple context windows are listed as separate entries
 * (e.g., "Opus 4.6" for 200k and "Opus 4.6 1M" for 1M). This removes the
 * need for a separate context window selector — the user just picks the
 * model variant they want from the model picker.
 *
 * The 1M variants use a `-1m` suffix on the model ID (e.g., `claude-opus-4-6-1m`).
 * `resolveApiModelId()` converts this to the SDK format with `[1m]` suffix.
 */
export const CLAUDE_CODE_MODELS: ModelInfo[] = [
	// ── Opus 4.7 ─────────────────────────────────────────────
	{
		id: "claude-opus-4-7",
		name: "Opus 4.7",
		providerId: CLAUDE_CODE_PROVIDER_ID,
		family: "claude-opus",
		supportsImages: true,
		supportsTools: true,
		supportsReasoning: true,
		supportsTemperature: false,
		modalities: { input: ["text", "image"], output: ["text"] },
		contextWindow: CONTEXT_200K,
		maxOutput: MAX_OUTPUT,
		pricing: zeroPricing,
		status: "active",
		effortLevels: [...REASONING_EFFORT],
		defaultEffort: DEFAULT_EFFORT,
		promptInjectedEffort: [...PROMPT_INJECTED_EFFORT],
	},
	{
		id: "claude-opus-4-7-1m",
		name: "Opus 4.7 1M",
		providerId: CLAUDE_CODE_PROVIDER_ID,
		family: "claude-opus",
		supportsImages: true,
		supportsTools: true,
		supportsReasoning: true,
		supportsTemperature: false,
		modalities: { input: ["text", "image"], output: ["text"] },
		contextWindow: CONTEXT_1M,
		maxOutput: MAX_OUTPUT,
		pricing: zeroPricing,
		status: "active",
		effortLevels: [...REASONING_EFFORT],
		defaultEffort: DEFAULT_EFFORT,
		promptInjectedEffort: [...PROMPT_INJECTED_EFFORT],
	},
	// ── Opus 4.6 ─────────────────────────────────────────────
	{
		id: "claude-opus-4-6",
		name: "Opus 4.6",
		providerId: CLAUDE_CODE_PROVIDER_ID,
		family: "claude-opus",
		supportsImages: true,
		supportsTools: true,
		supportsReasoning: true,
		supportsTemperature: false,
		modalities: { input: ["text", "image"], output: ["text"] },
		contextWindow: CONTEXT_200K,
		maxOutput: MAX_OUTPUT,
		pricing: zeroPricing,
		status: "active",
		effortLevels: [...REASONING_EFFORT],
		defaultEffort: DEFAULT_EFFORT,
		promptInjectedEffort: [...PROMPT_INJECTED_EFFORT],
	},
	{
		id: "claude-opus-4-6-1m",
		name: "Opus 4.6 1M",
		providerId: CLAUDE_CODE_PROVIDER_ID,
		family: "claude-opus",
		supportsImages: true,
		supportsTools: true,
		supportsReasoning: true,
		supportsTemperature: false,
		modalities: { input: ["text", "image"], output: ["text"] },
		contextWindow: CONTEXT_1M,
		maxOutput: MAX_OUTPUT,
		pricing: zeroPricing,
		status: "active",
		effortLevels: [...REASONING_EFFORT],
		defaultEffort: DEFAULT_EFFORT,
		promptInjectedEffort: [...PROMPT_INJECTED_EFFORT],
	},
	// ── Sonnet 4.6 ───────────────────────────────────────────
	{
		id: "claude-sonnet-4-6",
		name: "Sonnet 4.6",
		providerId: CLAUDE_CODE_PROVIDER_ID,
		family: "claude-sonnet",
		supportsImages: true,
		supportsTools: true,
		supportsReasoning: true,
		supportsTemperature: false,
		modalities: { input: ["text", "image"], output: ["text"] },
		contextWindow: CONTEXT_200K,
		maxOutput: MAX_OUTPUT,
		pricing: zeroPricing,
		status: "active",
		effortLevels: [...REASONING_EFFORT],
		defaultEffort: DEFAULT_EFFORT,
		promptInjectedEffort: [...PROMPT_INJECTED_EFFORT],
	},
	{
		id: "claude-sonnet-4-6-1m",
		name: "Sonnet 4.6 1M",
		providerId: CLAUDE_CODE_PROVIDER_ID,
		family: "claude-sonnet",
		supportsImages: true,
		supportsTools: true,
		supportsReasoning: true,
		supportsTemperature: false,
		modalities: { input: ["text", "image"], output: ["text"] },
		contextWindow: CONTEXT_1M,
		maxOutput: MAX_OUTPUT,
		pricing: zeroPricing,
		status: "active",
		effortLevels: [...REASONING_EFFORT],
		defaultEffort: DEFAULT_EFFORT,
		promptInjectedEffort: [...PROMPT_INJECTED_EFFORT],
	},
	// ── Haiku 4.5 ────────────────────────────────────────────
	{
		id: "claude-haiku-4-5",
		name: "Haiku 4.5",
		providerId: CLAUDE_CODE_PROVIDER_ID,
		family: "claude-haiku",
		supportsImages: true,
		supportsTools: true,
		supportsReasoning: false,
		supportsTemperature: false,
		modalities: { input: ["text", "image"], output: ["text"] },
		contextWindow: CONTEXT_200K,
		maxOutput: MAX_OUTPUT,
		pricing: zeroPricing,
		status: "active",
		effortLevels: [...BASIC_EFFORT],
		defaultEffort: DEFAULT_EFFORT,
	},
]

/**
 * Check whether a given model ID belongs to the Claude Code provider.
 */
export function isClaudeCodeModel(modelId: string): boolean {
	return CLAUDE_CODE_MODELS.some((m) => m.id === modelId)
}

/**
 * Resolve the API model ID to pass to the SDK's `query()`.
 *
 * 1M variants use a `-1m` suffix in our catalog (e.g., `claude-opus-4-6-1m`).
 * The SDK expects `claude-opus-4-6[1m]` — this function converts between the two.
 * For base (200k) models, the model ID is passed through unchanged.
 */
export function resolveApiModelId(modelId: string): string {
	if (modelId.endsWith(CONTEXT_1M_SUFFIX)) {
		return `${modelId.slice(0, -CONTEXT_1M_SUFFIX.length)}[1m]`
	}
	return modelId
}

/**
 * Extract the base model ID (without context window suffix).
 * Used to look up model capabilities when the variant doesn't matter.
 */
export function baseModelId(modelId: string): string {
	if (modelId.endsWith(CONTEXT_1M_SUFFIX)) {
		return modelId.slice(0, -CONTEXT_1M_SUFFIX.length)
	}
	return modelId
}

/**
 * Resolve the SDK effort value from user-selected effort.
 *
 * Returns `undefined` for "ultrathink" (handled as prompt prefix) and for
 * unsupported effort levels. The SDK accepts "low" | "medium" | "high" | "max".
 */
export function resolveEffort(
	effort: string | undefined,
	modelId: string,
): { sdkEffort?: string; isUltrathink: boolean } {
	if (!effort) return { isUltrathink: false }

	if (effort === "ultrathink") {
		return { isUltrathink: true }
	}

	const model = CLAUDE_CODE_MODELS.find((m) => m.id === modelId)
	const supported = model?.effortLevels ?? []
	if (!supported.includes(effort)) return { isUltrathink: false }

	return { sdkEffort: effort, isUltrathink: false }
}

/** Prefix a prompt with "Ultrathink:\n" for prompt-injected effort. */
export function applyUltrathinkPrefix(prompt: string): string {
	return `Ultrathink:\n${prompt}`
}
