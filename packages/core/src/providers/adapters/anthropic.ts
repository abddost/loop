/**
 * Anthropic provider adapter using @ai-sdk/anthropic.
 *
 * Returns a ProviderFactory that creates LanguageModel instances via
 * `provider.languageModel()`, which is the correct API surface for
 * Anthropic models in AI SDK v6.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import type { ProviderAdapter, ProviderConfig } from '@coding-assistant/shared';

export const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',
  create: (config: ProviderConfig) => {
    const provider = createAnthropic({
      apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY,
      baseURL: config.baseUrl,
      ...config.options,
    });
    return (modelId: string) => provider.languageModel(modelId);
  },
};
