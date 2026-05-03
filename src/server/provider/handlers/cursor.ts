import { CURSOR_PROVIDER_ID, getEffortSuffix, inferFamily } from "@core/cursor-tiers"
import { Cursor } from "@cursor/sdk"
import type { LanguageModel } from "ai"
import { Auth } from "../../auth"
import { getConfigValue } from "../../db/queries"
import { createLogger } from "../../logger"
import type { AuthAuthorization, AuthHandler } from "../auth-handler"
import type { ModelInfo, ProviderConfig, ProviderCredentials } from "../base"

/**
 * Cursor provider — backed by `@cursor/sdk@^1.0.7`.
 *
 * The actual chat path does NOT go through `createLanguageModel` — see
 * `src/server/loop/dispatch.ts` and `src/server/loop/cursor/runtime.ts`.
 * Loop dispatches Cursor turns to a dedicated SDK-driven runtime, mirroring
 * the Claude Code integration. This file only configures discovery and auth
 * for the model picker.
 *
 * Auth is API-key only (per the Cursor SDK requirement). Get a key from
 * `cursor.com/dashboard/integrations` and paste it into Loop's settings.
 */

export { CURSOR_PROVIDER_ID } from "@core/cursor-tiers"

const log = createLogger("cursor-provider")

const CURSOR_API_KEY_ENV = "CURSOR_API_KEY"
const PROVIDER_CONFIG_KEY = `provider:${CURSOR_PROVIDER_ID}:apiKey`

// ─── API key resolution ─────────────────────────────────────────────

/**
 * Resolve the active Cursor API key.
 *
 * Order: in-memory → Auth module file → SQLite legacy config → env var.
 * Mirrors `AuthManager.getApiKey` so the runtime doesn't need a handle on
 * the live AuthManager — keeps the cursor loop runtime decoupled from the
 * server bootstrap.
 */
export async function resolveCursorApiKey(): Promise<string | undefined> {
	// 1. Auth module (file-based, primary)
	const authInfo = await Auth.get(CURSOR_PROVIDER_ID)
	if (authInfo?.type === "api-key" && authInfo.key.length > 0) return authInfo.key

	// 2. Legacy SQLite config
	const stored = getConfigValue(PROVIDER_CONFIG_KEY)
	if (stored) {
		try {
			const key = JSON.parse(stored)
			if (typeof key === "string" && key.length > 0) return key
		} catch {
			// malformed; ignore
		}
	}

	// 3. Environment variable
	const fromEnv = process.env[CURSOR_API_KEY_ENV]
	if (fromEnv && fromEnv.length > 0) return fromEnv

	return undefined
}

/** True if any source (file/SQLite/env) yields an API key. */
export async function isCursorAuthenticated(): Promise<boolean> {
	const key = await resolveCursorApiKey()
	return !!key
}

// ─── Models ─────────────────────────────────────────────────────────

function modelInfo(id: string, name: string, opts: Partial<ModelInfo> = {}): ModelInfo {
	const family = inferFamily(id)
	return {
		id,
		name,
		providerId: CURSOR_PROVIDER_ID,
		...(family ? { family } : {}),
		supportsImages: true,
		supportsTools: true,
		supportsReasoning: false,
		supportsTemperature: false,
		contextWindow: 200_000,
		maxOutput: 16384,
		pricing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		status: "active" as const,
		modalities: { input: ["text", "image"], output: ["text"] },
		...opts,
	}
}

const million = { contextWindow: 1_000_000, maxOutput: 65536 } as const

/**
 * Hardcoded fallback list used when `Cursor.models.list()` fails (offline,
 * invalid key, server outage). These are CANONICAL SDK base ids — the SDK
 * rejects anything not in this set with a "Cannot use this model" error.
 * Variants (thinking, max, etc.) are NOT in the fallback because the SDK
 * encodes them as `params`, not in the id; they appear in the picker once
 * the user has an API key and `Cursor.models.list()` returns variant data.
 *
 * Last verified against the SDK error message on 2026-04-30.
 */
const FALLBACK_MODELS: ModelInfo[] = [
	modelInfo("default", "Auto (default)"),
	modelInfo("composer-2", "Composer 2"),
	modelInfo("composer-1.5", "Composer 1.5"),
	// Claude 4.x
	modelInfo("claude-opus-4-7", "Opus 4.7", million),
	modelInfo("claude-opus-4-6", "Opus 4.6", million),
	modelInfo("claude-opus-4-5", "Opus 4.5", { maxOutput: 32768 }),
	modelInfo("claude-sonnet-4-6", "Sonnet 4.6", million),
	modelInfo("claude-sonnet-4-5", "Sonnet 4.5", million),
	modelInfo("claude-sonnet-4", "Sonnet 4"),
	modelInfo("claude-haiku-4-5", "Haiku 4.5"),
	// GPT-5.x
	modelInfo("gpt-5.5", "GPT-5.5", million),
	modelInfo("gpt-5.4", "GPT-5.4", million),
	modelInfo("gpt-5.4-mini", "GPT-5.4 Mini", million),
	modelInfo("gpt-5.4-nano", "GPT-5.4 Nano", million),
	modelInfo("gpt-5.3-codex", "Codex 5.3", { maxOutput: 32768 }),
	modelInfo("gpt-5.3-codex-spark", "Codex 5.3 Spark", { maxOutput: 32768 }),
	modelInfo("gpt-5.2", "GPT-5.2", million),
	modelInfo("gpt-5.2-codex", "Codex 5.2", { maxOutput: 32768 }),
	modelInfo("gpt-5.1", "GPT-5.1", million),
	modelInfo("gpt-5.1-codex-max", "Codex 5.1 Max", { maxOutput: 32768 }),
	modelInfo("gpt-5.1-codex-mini", "Codex 5.1 Mini", { maxOutput: 32768 }),
	modelInfo("gpt-5-mini", "GPT-5 Mini"),
	// Gemini / Grok / Kimi
	modelInfo("gemini-3.1-pro", "Gemini 3.1 Pro", million),
	modelInfo("gemini-3-flash", "Gemini 3 Flash"),
	modelInfo("gemini-2.5-flash", "Gemini 2.5 Flash"),
	modelInfo("grok-4-20", "Grok 4.20"),
	modelInfo("kimi-k2.5", "Kimi K2.5"),
]

// ─── Variant id encoding ────────────────────────────────────────────
//
// The SDK accepts model selections as `{ id: <baseId>, params?: [{ id, value }] }`.
// Loop's ModelInfo schema is keyed by a single string, so when a base model
// has variants we flatten each variant into its own ModelInfo row whose id
// encodes the params: `<baseId>:<key1>=<value1>&<key2>=<value2>`.
// `decodeVariantId` reverses this for the runtime when calling `agent.send`.
//
// We use `:` as the base/params separator because none of the canonical
// base ids contain it. `&`/`=` are URL-query style and familiar.

const VARIANT_SEP = ":"

export interface DecodedVariantId {
	baseId: string
	params: Array<{ id: string; value: string }>
}

/** Encode a base id + variant params into a Loop model id. */
export function encodeVariantId(
	baseId: string,
	params: ReadonlyArray<{ id: string; value: string }>,
): string {
	if (params.length === 0) return baseId
	const encoded = params.map((p) => `${p.id}=${p.value}`).join("&")
	return `${baseId}${VARIANT_SEP}${encoded}`
}

/** Decode a Loop model id into the SDK's `{ id, params }` shape. */
export function decodeVariantId(modelId: string): DecodedVariantId {
	const sepIdx = modelId.indexOf(VARIANT_SEP)
	if (sepIdx === -1) return { baseId: modelId, params: [] }
	const baseId = modelId.slice(0, sepIdx)
	const paramStr = modelId.slice(sepIdx + 1)
	if (!paramStr) return { baseId, params: [] }
	const params: Array<{ id: string; value: string }> = []
	for (const pair of paramStr.split("&")) {
		const eqIdx = pair.indexOf("=")
		if (eqIdx === -1) continue
		const id = pair.slice(0, eqIdx)
		const value = pair.slice(eqIdx + 1)
		if (id) params.push({ id, value })
	}
	return { baseId, params }
}

/**
 * Heuristic capability inference from `id` + `displayName` returned by
 * `Cursor.models.list()`. Cursor doesn't surface context-window / output
 * caps, so we encode known families here and update as new families ship.
 */
function inferModelCapabilities(id: string, name: string): Partial<ModelInfo> {
	const lowerId = id.toLowerCase()
	const lowerName = name.toLowerCase()
	const effort = getEffortSuffix(lowerId)
	const isThinking = lowerId.includes("thinking")

	const hasMillion =
		lowerName.includes("1m") ||
		lowerId.includes("opus-4-7") ||
		lowerId.includes("4.6-opus") ||
		lowerId.includes("4.6-sonnet") ||
		lowerId.includes("4.5-sonnet") ||
		lowerId.includes("gpt-5.4") ||
		lowerId.startsWith("gemini-3") ||
		lowerId.includes("sonnet-1m")

	const largeOutput = isThinking || effort === "max" || effort === "xhigh"

	return {
		...(isThinking ? { supportsReasoning: true } : {}),
		...(hasMillion ? { contextWindow: 1_000_000 } : {}),
		...(largeOutput ? { maxOutput: 65536 } : {}),
	}
}

// ─── Model labeling (ported from cookbook coding-agent-cli) ─────────
//
// Cursor's `Cursor.models.list()` returns SDKModel rows that may carry
// `variants` (preset combinations of params). We flatten each variant
// into its own picker row, but apply three layers of cleanup taken from
// the cookbook reference (`coding-agent-cli/src/agent.ts:261-360`):
//
//   1. `buildVariantLabel`: combine base displayName with the variant's
//      displayName as `Base - Variant`, dropping the suffix when they're
//      effectively the same.
//   2. `dedupeModelChoices`: collapse identical `{ id, params }` tuples
//      (the SDK occasionally exposes duplicates under different displayNames).
//   3. `disambiguateDuplicateLabels`: when a model has two variants that
//      ended up with the same displayed label, append the param values.
//
// Final picker label format examples:
//   "Composer 2"
//   "Composer 2 - Fast"
//   "Opus 4.7 - Thinking High"
//   "Opus 4.7 - Thinking High (budget=large)"  (only if disambiguation needed)

interface ModelChoice {
	label: string
	id: string
	params: Array<{ id: string; value: string }>
	description?: string
}

/** Stable key for `{ id, params }` deduping. */
function modelSelectionKey(
	id: string,
	params: ReadonlyArray<{ id: string; value: string }>,
): string {
	const sorted = [...params].sort((a, b) => a.id.localeCompare(b.id))
	return `${id}::${sorted.map((p) => `${p.id}=${p.value}`).join("&")}`
}

/** Normalise for case-insensitive label compare (cookbook agent.ts:285). */
function labelsMatch(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** Build the variant's label as `Base - Variant`, dropping redundant suffix. */
function buildVariantLabel(baseLabel: string, variantDisplayName: string): string {
	const variantLabel = variantDisplayName.trim()
	if (!variantLabel || labelsMatch(baseLabel, variantLabel)) return baseLabel
	return `${baseLabel} - ${variantLabel}`
}

/**
 * Pretty-print params using the model's parameter definitions, falling back
 * to `id=value` when no displayName is available. Mirrors the cookbook's
 * formatParamsLabel (coding-agent-cli/src/agent.ts:438-457). Produces labels
 * like "Reasoning: High, Fast" instead of "reasoning=high&fast=true".
 */
function formatParamsLabel(
	params: ReadonlyArray<{ id: string; value: string }>,
	model?: {
		parameters?: Array<{
			id: string
			displayName?: string
			values: Array<{ value: string; displayName?: string }>
		}>
	},
): string {
	if (params.length === 0) return ""
	return params
		.map((param) => {
			const def = model?.parameters?.find((p) => p.id === param.id)
			const valueDef = def?.values.find((v) => v.value === param.value)
			const paramLabel = def?.displayName || labelFromId(param.id)
			const valueLabel = valueDef?.displayName || labelFromId(param.value)
			// When the param's name and value name are effectively the same
			// (e.g. param "fast" with value displayName "Fast"), drop the
			// redundant prefix.
			if (paramLabel.toLowerCase() === valueLabel.toLowerCase()) return valueLabel
			return `${paramLabel}: ${valueLabel}`
		})
		.join(", ")
}

/** Fallback display name when the SDK doesn't provide one. e.g. "fast" → "Fast". */
function labelFromId(id: string): string {
	if (!id) return id
	const cleaned = id.replace(/[-_]/g, " ")
	return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

/** Build choices for a single SDKModel: one row per (deduped, disambiguated) variant. */
function modelToChoices(item: {
	id: string
	displayName?: string
	description?: string
	parameters?: Array<{
		id: string
		displayName?: string
		values: Array<{ value: string; displayName?: string }>
	}>
	variants?: Array<{
		params: Array<{ id: string; value: string }>
		displayName: string
		description?: string
		isDefault?: boolean
	}>
}): ModelChoice[] {
	const baseLabel = item.displayName || item.id
	const variants = Array.isArray(item.variants) ? item.variants : []

	if (variants.length === 0) {
		return [{ label: baseLabel, id: item.id, params: [], description: item.description }]
	}

	// Build raw variant choices. The default variant gets the unsuffixed
	// base label so the picker shows e.g. "Composer 2" for the canonical
	// row instead of two variants both labelled "Composer 2".
	const raw: ModelChoice[] = variants.map((variant) => {
		const isDefault = variant.isDefault === true
		const label = isDefault ? baseLabel : buildVariantLabel(baseLabel, variant.displayName)
		return {
			label,
			id: item.id,
			params: variant.params,
			description: variant.description ?? item.description,
		}
	})

	// Dedupe identical { id, params } tuples (SDK can emit duplicates).
	const byKey = new Map<string, ModelChoice>()
	for (const choice of raw) {
		const key = modelSelectionKey(choice.id, choice.params)
		const existing = byKey.get(key)
		if (!existing) {
			byKey.set(key, choice)
		} else if (!existing.description && choice.description) {
			byKey.set(key, { ...existing, description: choice.description })
		}
	}
	const deduped = Array.from(byKey.values())

	// Disambiguate within the model: if two variants share a label, append
	// params using the SDK's parameter+value displayNames for clean text.
	const labelCounts = new Map<string, number>()
	for (const choice of deduped)
		labelCounts.set(choice.label, (labelCounts.get(choice.label) ?? 0) + 1)
	return deduped.map((choice) => {
		if ((labelCounts.get(choice.label) ?? 0) <= 1) return choice
		const suffix = formatParamsLabel(choice.params, item)
		return suffix ? { ...choice, label: `${choice.label} (${suffix})` } : choice
	})
}

/**
 * Discover models via `Cursor.models.list()`. Returns the fallback list
 * if no API key is configured or the call fails — Loop should boot to
 * the picker even when Cursor is unconfigured.
 *
 * Each variant becomes its own picker row. The Loop model id encodes the
 * variant params via `encodeVariantId` so the runtime can split them back
 * into the SDK's `{ id, params }` shape. Display labels follow the
 * cookbook's `Base - Variant` convention (see `modelToChoices`).
 */
export async function discoverCursorModels(): Promise<ModelInfo[]> {
	const apiKey = await resolveCursorApiKey()
	if (!apiKey) {
		log.debug("No Cursor API key configured, using fallback models")
		return FALLBACK_MODELS
	}
	try {
		const items = await Cursor.models.list({ apiKey })
		const choices: ModelChoice[] = []
		for (const item of items) choices.push(...modelToChoices(item))

		// Cross-model label collisions (rare, but possible when two base
		// models have the same friendly displayName). Append the model id
		// to disambiguate, matching the cookbook's global pass.
		const globalCounts = new Map<string, number>()
		for (const c of choices) globalCounts.set(c.label, (globalCounts.get(c.label) ?? 0) + 1)

		const models: ModelInfo[] = []
		for (const choice of choices) {
			const label =
				(globalCounts.get(choice.label) ?? 0) > 1 ? `${choice.label} (${choice.id})` : choice.label
			const encodedId = encodeVariantId(choice.id, choice.params)
			models.push(modelInfo(encodedId, label, inferModelCapabilities(encodedId, label)))
		}

		if (models.length === 0) return FALLBACK_MODELS
		log.info("Discovered Cursor models", {
			count: models.length,
			baseModels: items.length,
		})
		return models
	} catch (err) {
		log.warn("Cursor.models.list failed, falling back", {
			error: err instanceof Error ? err.message : String(err),
		})
		return FALLBACK_MODELS
	}
}

export function isCursorModel(modelId: string): boolean {
	return cursorProvider.models.some((m) => m.id === modelId)
}

/**
 * Validate a candidate API key by calling `Cursor.me()`. Returns the
 * authenticated user's email/name on success, or undefined if invalid.
 * Used by the settings UI when the user pastes a key.
 */
export async function validateCursorApiKey(
	apiKey: string,
): Promise<{ email?: string; name?: string } | undefined> {
	if (!apiKey) return undefined
	try {
		const user = await Cursor.me({ apiKey })
		return {
			email: user.userEmail,
			name:
				user.userFirstName || user.userLastName
					? `${user.userFirstName ?? ""} ${user.userLastName ?? ""}`.trim()
					: undefined,
		}
	} catch (err) {
		log.debug("validateCursorApiKey failed", {
			error: err instanceof Error ? err.message : String(err),
		})
		return undefined
	}
}

// ─── Provider Config ────────────────────────────────────────────────

/**
 * Stub `createModel` — Loop's dispatch routes Cursor turns to
 * `runCursorLoop`, which calls the SDK directly. This factory should
 * never be invoked. We throw rather than returning a misleading model
 * object so any accidental code path is loud.
 */
function unreachableLanguageModel(modelId: string): LanguageModel {
	const err = new Error(
		`Cursor model "${modelId}" cannot be used through the AI SDK path — Loop dispatches Cursor turns to runCursorLoop. This is a dispatch wiring bug.`,
	)
	// Implements the V2 minimal shape so type-checking succeeds.
	return {
		specificationVersion: "v2",
		provider: CURSOR_PROVIDER_ID,
		modelId,
		supportedUrls: {},
		async doGenerate() {
			throw err
		},
		async doStream() {
			throw err
		},
	} as unknown as LanguageModel
}

export const cursorProvider: ProviderConfig = {
	id: CURSOR_PROVIDER_ID,
	name: "Cursor",
	description: "Cursor SDK — uses your Cursor Pro/Business plan via @cursor/sdk",
	npm: "@cursor/sdk",
	auth: { methods: ["api-key"], envKeys: [CURSOR_API_KEY_ENV] },
	models: FALLBACK_MODELS,
	createModel(modelId: string, _credentials: ProviderCredentials): LanguageModel {
		return unreachableLanguageModel(modelId)
	},
}

// ─── Auth Handler ───────────────────────────────────────────────────

/**
 * Minimal auth handler so the settings UI shows "Sign in with API key"
 * with a clear description and a link to the dashboard. The actual key
 * is stored via `PUT /providers/:id` (existing API-key route) — `authorize`
 * is never called for `api-key` methods, so it throws if invoked.
 */
export const cursorHandler: AuthHandler = {
	providerId: CURSOR_PROVIDER_ID,
	methods: [
		{
			id: "api-key",
			type: "api-key",
			label: "Cursor API key",
			description: "Generate one at cursor.com/dashboard/integrations (key starts with `crsr_`).",
			prompts: [
				{
					type: "text",
					key: "apiKey",
					label: "Cursor API key",
					placeholder: "crsr_...",
				},
			],
		},
	],
	async authorize(): Promise<AuthAuthorization> {
		throw new Error(
			"Cursor uses API-key auth — submit the key via PUT /providers/cursor instead of authorize().",
		)
	},
}
