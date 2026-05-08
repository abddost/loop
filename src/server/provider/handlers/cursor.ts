import { tmpdir } from "node:os"
import { CURSOR_PROVIDER_ID, inferFamily } from "@core/cursor-tiers"
import type { LanguageModel } from "ai"
import { Auth } from "../../auth"
import { getConfigValue } from "../../db/queries"
import { createLogger } from "../../logger"
import { AcpClient } from "../../loop/cursor/acp/client"
import type { AuthAuthorization, AuthHandler } from "../auth-handler"
import type { ModelInfo, ProviderConfig, ProviderCredentials } from "../base"

const log = createLogger("cursor-provider")

/**
 * Cursor provider — backed by the open Agent Client Protocol (ACP).
 *
 * The chat path does NOT go through `createLanguageModel`. Loop dispatches
 * Cursor turns to a dedicated ACP runtime in `src/server/loop/cursor/` that
 * spawns the Cursor agent binary and speaks ACP over stdio.
 *
 * Auth: ACP's `cursor_login` method delegates credentials to the Cursor
 * binary itself (run `cursor login` on the host). For convenience we still
 * accept an API key in settings and forward it to the spawned process via
 * `CURSOR_API_KEY`.
 */

export { CURSOR_PROVIDER_ID } from "@core/cursor-tiers"

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
 * Discover Cursor models for the picker.
 *
 * Strategy: spawn `agent acp` once and read the `models` field from the
 * `session/new` response. Cache for `MODEL_PROBE_TTL_MS` so repeated
 * picker opens don't re-spawn. On any failure (binary not found, auth
 * not configured, agent doesn't expose models) we fall back to the
 * hardcoded list so the picker still renders.
 */
const MODEL_PROBE_TTL_MS = 5 * 60 * 1000
const probeCache: { models: ModelInfo[]; expiresAt: number } | undefined = undefined
const probeState: {
	models: ModelInfo[] | undefined
	expiresAt: number
	inflight: Promise<ModelInfo[]> | undefined
} = { models: undefined, expiresAt: 0, inflight: undefined }
void probeCache // (kept for legacy import compatibility)

export async function discoverCursorModels(force = false): Promise<ModelInfo[]> {
	const now = Date.now()
	if (!force && probeState.models && probeState.expiresAt > now) {
		return probeState.models
	}
	if (probeState.inflight) return probeState.inflight

	const promise = (async () => {
		try {
			const probed = await probeCursorModelsViaAcp()
			if (probed.length > 0) {
				const merged = mergeProbedAndFallback(probed)
				probeState.models = merged
				probeState.expiresAt = now + MODEL_PROBE_TTL_MS
				return merged
			}
		} catch (err) {
			log.debug("Cursor ACP model probe failed; using fallback list", {
				error: err instanceof Error ? err.message : String(err),
			})
		}
		// Cache the fallback briefly so we don't thrash on repeated failures.
		probeState.models = FALLBACK_MODELS
		probeState.expiresAt = now + 30_000
		return FALLBACK_MODELS
	})()
	probeState.inflight = promise
	try {
		return await promise
	} finally {
		probeState.inflight = undefined
	}
}

/**
 * Spawn a one-shot `agent acp` subprocess and harvest available models from
 * the `session/new` response. Tears down the subprocess immediately after.
 * Times out aggressively (3s) so a misconfigured user doesn't block boot.
 */
async function probeCursorModelsViaAcp(): Promise<ModelInfo[]> {
	const env: NodeJS.ProcessEnv = { ...process.env }
	const apiKey = await resolveCursorApiKey()
	if (apiKey && !env.CURSOR_API_KEY) env.CURSOR_API_KEY = apiKey

	const client = new AcpClient({
		command: "agent",
		args: ["acp"],
		cwd: tmpdir(),
		env,
	})

	const probe = (async () => {
		await client.start()
		await client.initialize({
			protocolVersion: 1,
			clientCapabilities: {
				fs: { readTextFile: false, writeTextFile: false },
				terminal: false,
				_meta: { parameterizedModelPicker: true },
			},
			clientInfo: { name: "loop-model-probe", version: "0.1.0" },
		})
		await client.authenticate({ methodId: "cursor_login" })
		const session = await client.newSession({ cwd: tmpdir(), mcpServers: [] })
		return session.models?.availableModels ?? []
	})()

	const timeout = new Promise<unknown>((_, reject) => {
		setTimeout(() => reject(new Error("Cursor model probe timed out")), 3_000)
	})

	let models: unknown
	try {
		models = await Promise.race([probe, timeout])
	} finally {
		await client.dispose()
	}

	if (!Array.isArray(models)) return []
	return models.flatMap((m) => sessionModelInfoToLoopModels(m))
}

/** Convert a single ACP `SessionModelInfo` (with possible parameter variants)
 *  into one or more flat Loop ModelInfo rows.
 *
 *  ACP shipping implementations vary on the exact field names. We accept
 *  `id|modelId|name`, `displayName|label|name`, `parameters|params`, and
 *  `values|options` — and skip any item that doesn't yield a usable id
 *  rather than crashing the whole probe.
 *
 *  Exported (named with an underscore) so the unit tests can pin the
 *  defensive behaviour without spawning a real ACP subprocess.
 */
export function _sessionModelInfoToLoopModelsForTesting(item: unknown): ModelInfo[] {
	return sessionModelInfoToLoopModels(item)
}

function sessionModelInfoToLoopModels(item: unknown): ModelInfo[] {
	if (!item || typeof item !== "object") return []
	const r = item as Record<string, unknown>
	const baseId = pickStringField(r, ["id", "modelId", "model_id"])?.trim()
	if (!baseId) return []
	const baseLabel =
		pickStringField(r, ["displayName", "display_name", "label", "name"])?.trim() || baseId

	const paramsRaw = (r.parameters ?? r.params) as unknown
	const params = Array.isArray(paramsRaw)
		? paramsRaw
				.map((p) => normalizeModelParameter(p))
				.filter((p): p is NormalizedParameter => p !== undefined)
		: []
	if (params.length === 0) {
		return [modelInfo(baseId, baseLabel)]
	}

	// Cartesian product across parameter values, but cap at 16 variants to
	// keep the picker tractable. Cursor's typical models have 2-3 params
	// with 2-4 values each, well below the cap.
	const VARIANT_CAP = 16
	let combos: Array<Array<{ id: string; value: string; label?: string }>> = [[]]
	outer: for (const param of params) {
		const next: typeof combos = []
		for (const combo of combos) {
			for (const value of param.values) {
				next.push([
					...combo,
					{
						id: param.id,
						value: value.value,
						label: value.displayName?.trim() || value.value,
					},
				])
				if (next.length >= VARIANT_CAP) {
					combos = next
					break outer
				}
			}
		}
		if (next.length === 0) break
		combos = next
	}

	const out: ModelInfo[] = []
	for (const combo of combos) {
		const encodedId = encodeVariantId(
			baseId,
			combo.map((c) => ({ id: c.id, value: c.value })),
		)
		const labelSuffix = combo
			.map((c) => c.label)
			.filter((s): s is string => !!s)
			.join(", ")
		const label = labelSuffix ? `${baseLabel} - ${labelSuffix}` : baseLabel
		out.push(modelInfo(encodedId, label))
	}
	return out
}

interface NormalizedParameter {
	id: string
	values: Array<{ value: string; displayName?: string }>
}

/** Best-effort normalization of one entry in `SessionModelInfo.parameters`.
 *  Tolerates missing fields, alternative keys, and string-only value lists. */
function normalizeModelParameter(raw: unknown): NormalizedParameter | undefined {
	if (!raw || typeof raw !== "object") return undefined
	const r = raw as Record<string, unknown>
	const id = pickStringField(r, ["id", "key", "name"])?.trim()
	if (!id) return undefined
	const valuesRaw = (r.values ?? r.options ?? r.choices) as unknown
	if (!Array.isArray(valuesRaw)) return undefined
	const values: NormalizedParameter["values"] = []
	for (const entry of valuesRaw) {
		if (typeof entry === "string" && entry.length > 0) {
			values.push({ value: entry })
			continue
		}
		if (!entry || typeof entry !== "object") continue
		const e = entry as Record<string, unknown>
		const value = pickStringField(e, ["value", "id", "name"])
		if (!value) continue
		const displayName = pickStringField(e, ["displayName", "display_name", "label", "name"])
		values.push(displayName ? { value, displayName } : { value })
	}
	if (values.length === 0) return undefined
	return { id, values }
}

function pickStringField(
	obj: Record<string, unknown>,
	keys: ReadonlyArray<string>,
): string | undefined {
	for (const k of keys) {
		const v = obj[k]
		if (typeof v === "string" && v.length > 0) return v
	}
	return undefined
}

/**
 * Combine probed models (live) with fallback (canonical). Probed wins on
 * id collision; fallback fills in any base model the probe didn't report.
 */
function mergeProbedAndFallback(probed: ModelInfo[]): ModelInfo[] {
	const byId = new Map<string, ModelInfo>()
	for (const m of FALLBACK_MODELS) byId.set(m.id, m)
	for (const m of probed) byId.set(m.id, m)
	return Array.from(byId.values())
}

export function isCursorModel(modelId: string): boolean {
	return cursorProvider.models.some((m) => m.id === modelId)
}

/**
 * Light validation of a candidate Cursor API key. We can't make a remote
 * `me()` call without the SDK, so we check the format. The key is then
 * forwarded to the spawned `agent acp` process via `CURSOR_API_KEY` and
 * the binary itself decides whether it's valid (auth failure surfaces as
 * an ACP `authenticate` error).
 */
export async function validateCursorApiKey(
	apiKey: string,
): Promise<{ email?: string; name?: string } | undefined> {
	if (!apiKey) return undefined
	if (apiKey.startsWith("crsr_") && apiKey.length > 16) return {}
	return undefined
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
	description: "Cursor (Agent Client Protocol) — runs the `agent acp` binary on your machine.",
	npm: "cursor-agent",
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
