import type { ProviderInfo } from "@core/schema/provider"
import * as Config from "../../config"
import { type ClaudeCodeDetection, detectClaudeCode, rescanClaudeCode } from "./detect"
import {
	CLAUDE_CODE_MODELS,
	CLAUDE_CODE_PROVIDER_DESCRIPTION,
	CLAUDE_CODE_PROVIDER_ID,
	CLAUDE_CODE_PROVIDER_NAME,
} from "./models"

/**
 * Sibling registry for the Claude Code CLI provider.
 *
 * Claude Code is NOT a `ProviderConfig` — it can't produce an AI-SDK
 * `LanguageModel` because we drive it through a dedicated runtime (see
 * `src/server/loop/claude-code/runtime.ts`). Instead, `ProviderRegistry`
 * splices a synthetic `ProviderInfo` from this registry into its
 * `listCategorized()` output so the frontend model picker renders it as a
 * first-class provider.
 */
class ClaudeCodeRegistryImpl {
	/** Get the cached detection result or trigger a fresh scan. */
	async getDetection(force = false): Promise<ClaudeCodeDetection> {
		return force ? rescanClaudeCode() : detectClaudeCode()
	}

	/** Force a rescan — called after the user installs/updates the CLI. */
	async rescan(): Promise<ClaudeCodeDetection> {
		return rescanClaudeCode()
	}

	/**
	 * Is the CLI available AND authenticated? Gates whether the synthetic
	 * provider appears in the picker as `connected`.
	 */
	async isAvailable(): Promise<boolean> {
		const detection = await detectClaudeCode()
		return detection.installed && detection.authenticated
	}

	/** Installed but maybe not authenticated — used by settings UI. */
	async isInstalled(): Promise<boolean> {
		const detection = await detectClaudeCode()
		return detection.installed
	}

	/** Resolved binary path, or undefined if detection hasn't run yet. */
	async getBinaryPath(): Promise<string | undefined> {
		const detection = await detectClaudeCode()
		return detection.binaryPath
	}

	/**
	 * Build the synthetic `ProviderInfo` entry for the model picker.
	 *
	 * Returns `undefined` when the CLI is missing OR when the user has
	 * disabled the provider in settings. The settings card stays visible
	 * either way (so the user can re-enable / install) — only the entry
	 * surfaced to `ProviderRegistry.listCategorized()` disappears.
	 */
	async getProviderInfo(): Promise<ProviderInfo | undefined> {
		const settings = Config.read().claudeCode
		if (!settings.enabled) return undefined
		const detection = await detectClaudeCode()
		if (!detection.installed) return undefined

		const configured = detection.authenticated
		return {
			id: CLAUDE_CODE_PROVIDER_ID,
			name: CLAUDE_CODE_PROVIDER_NAME,
			description: CLAUDE_CODE_PROVIDER_DESCRIPTION,
			// Category is finalised by ProviderRegistry.listCategorized, but we
			// default to "connected" when authenticated so tests that bypass
			// the outer registry still get a sensible value.
			category: configured ? "connected" : "popular",
			configured,
			authMethods: [
				{
					id: "cli",
					type: "oauth",
					label: "Claude Code CLI",
					description: "Sign in via `claude login` in your terminal.",
					prompts: [],
				},
			],
			envKeys: [],
			models: CLAUDE_CODE_MODELS,
			source: "custom",
		}
	}
}

export const ClaudeCodeRegistry = new ClaudeCodeRegistryImpl()
