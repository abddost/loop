import type { ReasoningEffort } from "@core/schema/config"
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
	reasoningEffort: ReasoningEffort
	/** Claude Code "Fast mode" toggle. Persists across model switches —
	 *  the input bar only renders the toggle when the active model
	 *  exposes `supportsFastMode`, so this flag is silently ignored for
	 *  models that don't support it. */
	fastModeEnabled: boolean

	init(
		data: CategorizedProviders,
		defaultModel?: { providerId: string; modelId: string } | null,
		defaultReasoningEffort?: ReasoningEffort,
	): void
	setSelectedModel(providerId: string, modelId: string): void
	setReasoningEffort(effort: ReasoningEffort): void
	setFastModeEnabled(enabled: boolean): void
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
		reasoningEffort: "medium",
		fastModeEnabled: false,

		init(data, defaultModel, defaultReasoningEffort) {
			set((s) => {
				s.connected = data.connected
				s.popular = data.popular
				s.other = data.other
				if (defaultReasoningEffort) s.reasoningEffort = defaultReasoningEffort

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

		setReasoningEffort(effort) {
			set((s) => {
				s.reasoningEffort = effort
			})
		},

		setFastModeEnabled(enabled) {
			set((s) => {
				s.fastModeEnabled = enabled
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
