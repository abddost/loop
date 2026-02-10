/**
 * OpenRouter provider adapter.
 * OpenRouter exposes an OpenAI-compatible API at https://openrouter.ai/api/v1.
 */

import { createOpenAI } from '@ai-sdk/openai';
import type { ProviderAdapter, ProviderConfig } from '@coding-assistant/shared';

export const openrouterAdapter: ProviderAdapter = {
  id: 'openrouter',
  create: (config: ProviderConfig) => {
    return createOpenAI({
      apiKey: config.apiKey ?? process.env.OPENROUTER_API_KEY,
      baseURL: config.baseUrl ?? 'https://openrouter.ai/api/v1',
      ...config.options,
    });
  },
};
