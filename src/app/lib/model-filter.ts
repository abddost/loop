import type { ProviderInfo } from "@core/schema/provider"

/**
 * Composite key for a model: "providerId:modelId".
 * Used for the enabledModels config array.
 */
export function modelKey(providerId: string, modelId: string): string {
	return `${providerId}:${modelId}`
}

/**
 * Parse a composite model key back into providerId and modelId.
 */
export function parseModelKey(key: string): { providerId: string; modelId: string } | null {
	const idx = key.indexOf(":")
	if (idx === -1) return null
	return { providerId: key.slice(0, idx), modelId: key.slice(idx + 1) }
}

/**
 * Filter providers to only include explicitly enabled models.
 * Providers with zero enabled models are excluded from the result.
 */
export function filterByEnabledModels(
	providers: ProviderInfo[],
	enabledModels: string[],
): ProviderInfo[] {
	if (enabledModels.length === 0) return []
	const enabled = new Set(enabledModels)
	return providers
		.map((p) => ({
			...p,
			models: p.models.filter((m) => enabled.has(modelKey(p.id, m.id))),
		}))
		.filter((p) => p.models.length > 0)
}
