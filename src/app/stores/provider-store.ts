import type { ProviderInfo } from "@core/schema/provider"
import { create } from "zustand"
import { immer } from "zustand/middleware/immer"

interface CategorizedProviders {
	connected: ProviderInfo[]
	popular: ProviderInfo[]
	other: ProviderInfo[]
}

interface ProviderState {
	connected: ProviderInfo[]
	popular: ProviderInfo[]
	other: ProviderInfo[]
	selectedModel: { providerId: string; modelId: string } | null

	init(
		data: CategorizedProviders,
		defaultModel?: { providerId: string; modelId: string } | null,
	): void
	setSelectedModel(providerId: string, modelId: string): void
	getModel(providerId: string, modelId: string): ProviderInfo["models"][0] | undefined
	/** Flat list of all providers across categories. */
	allProviders(): ProviderInfo[]
}

export const useProviderStore = create<ProviderState>()(
	immer((set, get) => ({
		connected: [],
		popular: [],
		other: [],
		selectedModel: null,

		init(data, defaultModel) {
			set((s) => {
				s.connected = data.connected
				s.popular = data.popular
				s.other = data.other

				if (!s.selectedModel) {
					// Try config's defaultModel first
					if (defaultModel) {
						const all = [...data.connected, ...data.popular, ...data.other]
						const provider = all.find((p) => p.id === defaultModel.providerId)
						const model = provider?.models.find((m) => m.id === defaultModel.modelId)
						if (model) {
							s.selectedModel = {
								providerId: defaultModel.providerId,
								modelId: defaultModel.modelId,
							}
							return
						}
					}
					// Fall back to first connected provider's first model
					const firstConnected = data.connected[0]
					if (firstConnected?.models[0]) {
						s.selectedModel = {
							providerId: firstConnected.id,
							modelId: firstConnected.models[0].id,
						}
					}
				}
			})
		},

		setSelectedModel(providerId, modelId) {
			set((s) => {
				s.selectedModel = { providerId, modelId }
			})
		},

		getModel(providerId, modelId) {
			const state = get()
			const all = [...state.connected, ...state.popular, ...state.other]
			const provider = all.find((p) => p.id === providerId)
			return provider?.models.find((m) => m.id === modelId)
		},

		allProviders() {
			const state = get()
			return [...state.connected, ...state.popular, ...state.other]
		},
	})),
)
