/**
 * Model resolver -- resolves a model string to a provider + model.
 */

import type { ProviderConfig, ProviderFactory, ModelInfo } from '@coding-assistant/shared';
import { providerRegistry } from './registry.js';
import { modelCatalog } from './catalog.js';

export interface ResolvedModel {
  /** Factory that creates a LanguageModel for a given model ID */
  provider: ProviderFactory;
  modelId: string;
  providerId: string;
  info: ModelInfo | null;
}

/**
 * Resolve a model identifier to a provider instance + model ID.
 *
 * Supports formats:
 * - "openai:gpt-4o" -> OpenAI provider, model "gpt-4o"
 * - "anthropic:claude-3-5-sonnet" -> Anthropic provider, model "claude-3-5-sonnet"
 * - "gpt-4o" -> attempts to find the right provider
 */
export function resolveModel(
  modelString: string,
  providerConfigs: Record<string, ProviderConfig>,
): ResolvedModel {
  let providerId: string;
  let modelId: string;

  if (modelString.includes(':')) {
    [providerId, modelId] = modelString.split(':', 2);
  } else {
    // Try to look up in catalog
    const info = modelCatalog.findModel(modelString);
    if (info) {
      providerId = info.providerId;
      modelId = modelString;
    } else {
      // Default to openai
      providerId = 'openai';
      modelId = modelString;
    }
  }

  const config: ProviderConfig = {
    id: providerId,
    ...providerConfigs[providerId],
  };

  const provider = providerRegistry.getProvider(providerId, config);
  const info = modelCatalog.findModel(`${providerId}:${modelId}`);

  return { provider, modelId, providerId, info };
}
