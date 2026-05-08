import type { ModelInfo, ProviderInfo } from "@core/schema/provider"
import {
	OPENCODE_PROVIDER_DESCRIPTION,
	OPENCODE_PROVIDER_ID,
	OPENCODE_PROVIDER_NAME,
} from "./constants"
import { type OpenCodeDetection, detectOpenCode, rescanOpenCode } from "./detect"

/**
 * Sibling registry for the OpenCode provider runtime.
 *
 * Like Claude Code, OpenCode is NOT a `ProviderConfig` — it can't produce
 * an AI-SDK `LanguageModel`, so `ProviderRegistry` splices a synthetic
 * `ProviderInfo` from this registry into its `listCategorized()` output.
 *
 * Models are dynamic: we ask OpenCode `provider.list()` and surface every
 * model exposed by upstream providers it's connected to. Each Loop model
 * ID encodes both halves as `${upstreamProviderId}/${upstreamModelId}`
 * so downstream paths can route correctly without bespoke metadata.
 */
class OpenCodeRegistryImpl {
	async getDetection(force = false): Promise<OpenCodeDetection> {
		return force ? rescanOpenCode() : detectOpenCode()
	}

	async rescan(): Promise<OpenCodeDetection> {
		return rescanOpenCode()
	}

	/** Connected (provider lists at least one upstream) gates picker visibility as "connected". */
	async isConnected(): Promise<boolean> {
		const detection = await detectOpenCode()
		return detection.connected && (detection.connectedUpstreamCount ?? 0) > 0
	}

	/** Installed but maybe not yet authenticated upstream — used by settings UI. */
	async isInstalled(): Promise<boolean> {
		const detection = await detectOpenCode()
		return detection.installed
	}

	/**
	 * Build the synthetic `ProviderInfo` for the model picker.
	 *
	 * Returns `undefined` when neither the CLI is installed nor a remote
	 * server is configured — in that case we don't advertise the provider
	 * at all (the user has nothing to connect to yet).
	 */
	async getProviderInfo(): Promise<ProviderInfo | undefined> {
		const detection = await detectOpenCode()
		if (!detection.installed) return undefined

		const configured = detection.connected
		const models: ModelInfo[] = (detection.models ?? []).map((m) => ({
			id: m.id,
			name: m.name,
			providerId: OPENCODE_PROVIDER_ID,
			...(m.family ? { family: m.family } : {}),
			supportsImages: m.supportsImages,
			supportsTools: m.supportsTools,
			supportsReasoning: m.supportsReasoning,
			supportsTemperature: m.supportsTemperature,
			modalities: {
				input: ["text", ...(m.supportsImages ? ["image"] : [])],
				output: ["text"],
			},
			contextWindow: m.contextWindow,
			maxOutput: m.maxOutput,
			pricing: m.pricing,
			status: m.status,
			// Tag with the upstream provider name so the picker can group
			// or label "OpenAI · GPT-5" without re-parsing the slug.
			subProvider: m.upstreamProviderName,
			subProviderId: m.upstreamProviderId,
		}))

		return {
			id: OPENCODE_PROVIDER_ID,
			name: OPENCODE_PROVIDER_NAME,
			description: OPENCODE_PROVIDER_DESCRIPTION,
			category: configured ? "connected" : "popular",
			configured,
			authMethods: [
				{
					id: "cli",
					type: "oauth",
					label: "OpenCode CLI",
					description:
						"Run `opencode auth login` in your terminal, or configure a remote server in settings.",
					prompts: [],
				},
			],
			envKeys: [],
			models,
			source: "custom",
		}
	}
}

export const OpenCodeRegistry = new OpenCodeRegistryImpl()
