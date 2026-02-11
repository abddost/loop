/**
 * OpenRouter provider adapter.
 * OpenRouter exposes an OpenAI-compatible API at https://openrouter.ai/api/v1.
 *
 * In AI SDK v6 (@ai-sdk/openai v2), the default provider invocation uses the
 * Responses API. OpenRouter only supports Chat Completions, so we return
 * a model factory bound to provider.chat().
 */

import { createOpenAI } from '@ai-sdk/openai';
import type { ProviderAdapter, ProviderConfig } from '@coding-assistant/shared';

export const openrouterAdapter: ProviderAdapter = {
  id: 'openrouter',
  create: (config: ProviderConfig) => {
    const provider = createOpenAI({
      apiKey: config.apiKey ?? process.env.OPENROUTER_API_KEY,
      baseURL: config.baseUrl ?? 'https://openrouter.ai/api/v1',
      ...config.options,
    });
    // Return .chat() factory — forces Chat Completions API instead of Responses API
    return (modelId: string) => provider.chat(modelId);
  },
};
