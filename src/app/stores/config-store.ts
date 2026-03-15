import type { AppConfig } from "@core/schema/config"
import { DEFAULT_CONFIG } from "@core/schema/config"
import type { PermissionConfig } from "@core/schema/permission"
import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { apiClient } from "../lib/api-client"

/** Deep-partial config patch: permission section can be partially updated. */
interface ConfigPatch {
	theme?: AppConfig["theme"]
	defaultAgent?: string
	defaultModel?: AppConfig["defaultModel"]
	permission?: {
		approvalPolicy?: AppConfig["permission"]["approvalPolicy"]
		rules?: Partial<PermissionConfig>
	}
}

interface ConfigState {
	config: AppConfig

	init(config: AppConfig): void
	update(patch: ConfigPatch): Promise<void>
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

			// Optimistic update (deep merge for nested permission)
			set((s) => {
				const { permission: permPatch, ...rest } = patch
				Object.assign(s.config, rest)
				if (permPatch) {
					if (permPatch.approvalPolicy != null) {
						s.config.permission.approvalPolicy = permPatch.approvalPolicy
					}
					if (permPatch.rules) {
						Object.assign(s.config.permission.rules, permPatch.rules)
					}
				}
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
