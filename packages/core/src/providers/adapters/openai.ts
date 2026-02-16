/**
 * OpenAI provider adapter using @ai-sdk/openai.
 *
 * Returns a ProviderFactory that creates LanguageModel instances via the
 * Responses API (`provider.responses()`), which is the correct API surface
 * for OpenAI models in AI SDK v6.
 */

import { createOpenAI } from '@ai-sdk/openai';
import type { ProviderAdapter, ProviderConfig } from '@coding-assistant/shared';

export const openaiAdapter: ProviderAdapter = {
  id: 'openai',
  create: (config: ProviderConfig) => {
    const provider = createOpenAI({
      apiKey: config.apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: config.baseUrl,
      ...config.options,
    });
    return (modelId: string) => provider.responses(modelId);
  },
};
