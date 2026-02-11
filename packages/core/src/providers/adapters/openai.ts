/**
 * OpenAI provider adapter using @ai-sdk/openai.
 */

import { createOpenAI } from '@ai-sdk/openai';
import type { ProviderAdapter, ProviderConfig } from '@coding-assistant/shared';

export const openaiAdapter: ProviderAdapter = {
  id: 'openai',
  create: (config: ProviderConfig) => {
    return createOpenAI({
      apiKey: config.apiKey ?? process.env.OPENAI_API_KEY,
      baseURL: config.baseUrl,
      ...config.options,
    });
  },
};
