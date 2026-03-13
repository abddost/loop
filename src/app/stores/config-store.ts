import type { AppConfig } from "@core/schema/config"
import { DEFAULT_CONFIG } from "@core/schema/config"
import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { apiClient } from "../lib/api-client"

interface ConfigState {
	config: AppConfig

	init(config: AppConfig): void
	update(patch: Partial<AppConfig>): Promise<void>
}

export const useConfigStore = create<ConfigState>()(
	immer((set, get) => ({
		config: DEFAULT_CONFIG,

		init(config) {
			set((s) => {
				s.config = config
			})
		},

		async update(patch) {
			const previous = get().config

			// Optimistic update
			set((s) => {
				Object.assign(s.config, patch)
			})

			try {
				const updated = await apiClient.patch<AppConfig>("/config", patch)
				set((s) => {
					s.config = updated
				})
			} catch (err) {
				// Rollback on failure
				console.error("[config:update]", err)
				set((s) => {
					s.config = previous
				})
			}
		},
	})),
)
