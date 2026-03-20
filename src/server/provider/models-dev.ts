import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { ModelInfo } from "@core/schema/provider"
import { env } from "../env"
import { createLogger } from "../logger"

const log = createLogger("models-dev")

// ─── Types ──────────────────────────────────────────────────────

export interface ModelsDevModel {
	id: string
	name: string
	family?: string
	attachment?: boolean
	reasoning?: boolean
	tool_call?: boolean
	temperature?: boolean
	knowledge?: string
	release_date?: string
	last_updated?: string
	modalities?: {
		input?: string[]
		output?: string[]
	}
	open_weights?: boolean
	cost?: {
		input?: number
		output?: number
		cache_read?: number
		cache_write?: number
	}
	limit?: {
		context?: number
		input?: number
		output?: number
	}
	status?: "alpha" | "beta" | "deprecated"
	provider?: {
		npm?: string
		api?: string
	}
}

export interface ModelsDevProvider {
	id: string
	name: string
	npm?: string
	api?: string
	env?: string[]
	doc?: string
	models: Record<string, ModelsDevModel>
}

export type ModelsDevData = Record<string, ModelsDevProvider>

// ─── Constants ──────────────────────────────────────────────────

const FETCH_URL = process.env.LOOP_MODELS_URL ?? "https://models.dev"
const FETCH_TIMEOUT_MS = 10_000
const REFRESH_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
const INITIAL_DELAY_MS = 0
const CACHE_FILE = "models-dev.json"

/**
 * Maps models.dev provider IDs to our internal provider IDs
 * when they differ.
 */
const PROVIDER_ID_MAP: Record<string, string> = {
	"google-generative-ai": "google",
}

// ─── Cache State ────────────────────────────────────────────────

let l1Cache: ModelsDevData | null = null
let refreshTimer: ReturnType<typeof setInterval> | null = null
let onRefreshCallback: ((data: ModelsDevData) => void) | null = null

// ─── Public API ─────────────────────────────────────────────────

/**
 * Synchronously load models.dev data into L1 memory cache.
 * Tries file cache first, falls back to empty data.
 * Call at server startup before any provider resolution.
 */
export function loadModelsDevCache(): void {
	// Try file cache
	const filePath = getCacheFilePath()
	if (existsSync(filePath)) {
		try {
			const raw = readFileSync(filePath, "utf-8")
			l1Cache = JSON.parse(raw) as ModelsDevData
			log.info("Loaded from file cache")
			return
		} catch (err) {
			log.warn("Failed to read file cache", { error: err })
		}
	}

	// No cached data — will use empty until first network fetch
	l1Cache = {}
	log.info("No cached data available, will fetch from network")
}

/**
 * Get the current models.dev data (from L1 memory cache).
 * Never blocks on network. Returns empty record if no data loaded.
 */
export function getModelsDevData(): ModelsDevData {
	return l1Cache ?? {}
}

/**
 * Background refresh: fetch from network, update L2 file, reset L1.
 * Non-blocking, logs errors but doesn't throw.
 */
export async function refreshModelsDevCache(): Promise<void> {
	try {
		const response = await fetch(`${FETCH_URL}/api.json`, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			headers: { "User-Agent": "loop/1.0" },
		})

		if (!response.ok) {
			log.warn("Fetch failed", { status: response.status, statusText: response.statusText })
			return
		}

		const data = (await response.json()) as ModelsDevData

		// Write to L2 file cache
		const filePath = getCacheFilePath()
		await Bun.write(filePath, JSON.stringify(data))

		// Update L1 memory cache
		l1Cache = data
		log.info("Refreshed from network")

		// Notify registry to reload
		onRefreshCallback?.(data)
	} catch (err) {
		log.warn("Refresh failed", { error: err })
	}
}

/**
 * Register a callback to run after each successful network refresh.
 * Used by the registry to reload providers from updated data.
 */
export function onModelsDevRefresh(callback: (data: ModelsDevData) => void): void {
	onRefreshCallback = callback
}

/**
 * Start the background refresh schedule.
 * First refresh after INITIAL_DELAY_MS, then every REFRESH_INTERVAL_MS.
 */
export function scheduleModelsDevRefresh(): void {
	if (refreshTimer) return

	// Initial delayed refresh
	setTimeout(() => {
		refreshModelsDevCache()
	}, INITIAL_DELAY_MS)

	// Periodic refresh
	refreshTimer = setInterval(() => {
		refreshModelsDevCache()
	}, REFRESH_INTERVAL_MS)
	refreshTimer.unref()
}

// ─── Normalization ──────────────────────────────────────────────

/**
 * Resolve a models.dev provider ID to our internal ID.
 */
export function resolveProviderId(modelsDevId: string): string {
	return PROVIDER_ID_MAP[modelsDevId] ?? modelsDevId
}

/**
 * Normalize a single models.dev model entry into our ModelInfo format.
 */
export function normalizeModel(raw: ModelsDevModel, providerId: string): ModelInfo {
	const inputModalities = raw.modalities?.input ?? ["text"]
	const outputModalities = raw.modalities?.output ?? ["text"]

	return {
		id: raw.id,
		name: raw.name,
		providerId,
		family: raw.family,
		supportsImages: inputModalities.includes("image") || raw.attachment === true,
		supportsTools: raw.tool_call ?? false,
		supportsReasoning: raw.reasoning ?? false,
		supportsTemperature: raw.temperature ?? true,
		modalities: {
			input: inputModalities,
			output: outputModalities,
		},
		contextWindow: raw.limit?.context ?? 128_000,
		maxOutput: raw.limit?.output ?? 4_096,
		pricing: {
			input: raw.cost?.input ?? 0,
			output: raw.cost?.output ?? 0,
			cacheRead: raw.cost?.cache_read ?? 0,
			cacheWrite: raw.cost?.cache_write ?? 0,
		},
		status:
			raw.status === "alpha" || raw.status === "beta"
				? "beta"
				: raw.status === "deprecated"
					? "deprecated"
					: "active",
		releaseDate: raw.release_date,
	}
}

/**
 * Normalize a full models.dev provider entry.
 * Filters out deprecated models. Returns normalized provider info.
 */
export function normalizeProvider(raw: ModelsDevProvider): {
	id: string
	name: string
	envKeys: string[]
	npm: string
	apiBaseUrl?: string
	models: ModelInfo[]
} {
	const id = resolveProviderId(raw.id ?? "")
	const models: ModelInfo[] = []

	for (const [, model] of Object.entries(raw.models ?? {})) {
		if (model.status === "deprecated") continue
		models.push(normalizeModel(model, id))
	}

	return {
		id,
		name: raw.name ?? id,
		envKeys: raw.env ?? [],
		npm: raw.npm ?? "@ai-sdk/openai-compatible",
		apiBaseUrl: raw.api,
		models,
	}
}

// ─── Private ────────────────────────────────────────────────────

function getCacheFilePath(): string {
	return resolve(env.dataDir, "cache", CACHE_FILE)
}
