import type { AppConfig, Appearance, ReasoningConfig } from "@core/schema/config"
import { DEFAULT_CONFIG } from "@core/schema/config"
import type { McpServerConfig } from "@core/schema/mcp"
import type { PermissionConfig } from "@core/schema/permission"
import { create } from "zustand"
import { immer } from "zustand/middleware/immer"
import { apiClient } from "../lib/api-client"
import { applyAppearance, updateSystemListener } from "../lib/theme-engine"

/** Deep-partial config patch: permission and appearance can be partially updated. */
interface ConfigPatch {
	theme?: "dark" | "light"
	appearance?: Partial<Appearance>
	defaultAgent?: string
	defaultModel?: AppConfig["defaultModel"]
	enabledModels?: string[]
	defaultEditor?: string | null
	permission?: {
		approvalPolicy?: AppConfig["permission"]["approvalPolicy"]
		rules?: Partial<PermissionConfig>
	}
	mcp?: Record<string, McpServerConfig | null>
	reasoning?: Partial<ReasoningConfig>
	keybindings?: Record<string, string>
	worktree?: Partial<AppConfig["worktree"]>
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

			// Optimistic update (deep merge for nested permission + appearance)
			set((s) => {
				const {
					permission: permPatch,
					appearance: appearancePatch,
					reasoning: reasoningPatch,
					keybindings: keybindingsPatch,
					worktree: worktreePatch,
					...rest
				} = patch
				Object.assign(s.config, rest)
				if (keybindingsPatch) {
					s.config.keybindings = { ...s.config.keybindings, ...keybindingsPatch }
				}
				if (permPatch) {
					if (permPatch.approvalPolicy != null) {
						s.config.permission.approvalPolicy = permPatch.approvalPolicy
					}
					if (permPatch.rules) {
						Object.assign(s.config.permission.rules, permPatch.rules)
					}
				}
				if (reasoningPatch) {
					Object.assign(s.config.reasoning, reasoningPatch)
				}
				if (worktreePatch) {
					Object.assign(s.config.worktree, worktreePatch)
				}
				if (appearancePatch) {
					// Deep-merge per-mode color overrides
					if (appearancePatch.darkColorOverrides) {
						s.config.appearance.darkColorOverrides = {
							...s.config.appearance.darkColorOverrides,
							...appearancePatch.darkColorOverrides,
						}
					}
					if (appearancePatch.lightColorOverrides) {
						s.config.appearance.lightColorOverrides = {
							...s.config.appearance.lightColorOverrides,
							...appearancePatch.lightColorOverrides,
						}
					}
					const {
						darkColorOverrides: _d,
						lightColorOverrides: _l,
						...restAppearance
					} = appearancePatch
					Object.assign(s.config.appearance, restAppearance)
				}
			})

			// Apply appearance changes immediately
			const currentAppearance = get().config.appearance
			applyAppearance(currentAppearance)
			updateSystemListener(currentAppearance)

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
				// Re-apply previous appearance on rollback
				applyAppearance(previous.appearance)
				updateSystemListener(previous.appearance)
			}
		},
	})),
)
