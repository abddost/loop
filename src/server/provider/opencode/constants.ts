/**
 * Provider ID for the OpenCode runtime.
 *
 * Kept in a shared constant so the dispatcher, registry, routes, and
 * frontend picker all reference the same string. OpenCode is a synthetic
 * provider (no AI-SDK `LanguageModel`) — it proxies multiple upstream
 * providers under a single connection, and its models are routed through
 * the dedicated runtime (see `src/server/loop/opencode/runtime.ts`).
 */
export const OPENCODE_PROVIDER_ID = "opencode"

/** Human-readable name shown in the provider list and model picker. */
export const OPENCODE_PROVIDER_NAME = "OpenCode"

export const OPENCODE_PROVIDER_DESCRIPTION =
	"Route prompts through your local OpenCode CLI or a self-hosted server — exposes models from every upstream provider OpenCode is connected to."

/**
 * Floor version Loop has been tested against. Older CLIs may lack the v2
 * SDK endpoints (provider.list, session.prompt, event.subscribe) we rely on.
 * Surfaced as a soft warning in settings — we still try to run.
 */
export const MIN_OPENCODE_CLI_VERSION = "1.14.0"

/**
 * Separator used inside Loop model IDs to encode the upstream
 * provider+model combination OpenCode exposes (e.g. `openai/gpt-5`).
 *
 * We embed the upstream slug directly in `ModelInfo.id` so the standard
 * provider/model resolution paths (config persistence, picker key,
 * dispatcher routing) all work without bespoke handling.
 */
export const OPENCODE_MODEL_SLUG_SEPARATOR = "/"

/**
 * Encode an upstream provider+model into a single Loop model ID.
 * Mirrors t3code's `${providerID}/${modelID}` convention.
 */
export function encodeOpenCodeModelId(upstreamProviderId: string, upstreamModelId: string): string {
	return `${upstreamProviderId}${OPENCODE_MODEL_SLUG_SEPARATOR}${upstreamModelId}`
}

/**
 * Parse an OpenCode model ID back into upstream provider + model parts.
 * Returns `null` for malformed slugs (no separator, empty halves).
 */
export function parseOpenCodeModelId(
	modelId: string,
): { upstreamProviderId: string; upstreamModelId: string } | null {
	const idx = modelId.indexOf(OPENCODE_MODEL_SLUG_SEPARATOR)
	if (idx <= 0 || idx === modelId.length - 1) return null
	return {
		upstreamProviderId: modelId.slice(0, idx),
		upstreamModelId: modelId.slice(idx + 1),
	}
}
