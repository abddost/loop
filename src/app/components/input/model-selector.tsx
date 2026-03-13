import type { ProviderInfo } from "@core/schema/provider"
import { Select } from "../ui/select"

export interface ModelSelectorProps {
	providers: ProviderInfo[]
	selectedProviderId?: string
	selectedModelId?: string
	onSelect: (modelId: string, providerId: string) => void
	className?: string
}

/**
 * Dropdown showing available models grouped by provider.
 *
 * Uses composite `providerId:modelId` keys to disambiguate models
 * that share the same ID across multiple providers.
 */
export function ModelSelector({
	providers,
	selectedProviderId,
	selectedModelId,
	onSelect,
	className,
}: ModelSelectorProps) {
	const withModels = providers.filter((p) => p.models.length > 0)

	const selectedKey =
		selectedProviderId && selectedModelId ? `${selectedProviderId}:${selectedModelId}` : ""

	return (
		<Select
			value={selectedKey}
			onChange={(compositeKey) => {
				const sepIdx = compositeKey.indexOf(":")
				if (sepIdx === -1) return
				const providerId = compositeKey.slice(0, sepIdx)
				const modelId = compositeKey.slice(sepIdx + 1)
				onSelect(modelId, providerId)
			}}
			groups={withModels.map((p) => ({
				label: p.name,
				options: p.models.map((m) => ({
					value: `${p.id}:${m.id}`,
					label: m.name,
				})),
			}))}
			className={className}
		/>
	)
}
