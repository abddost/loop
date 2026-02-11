/**
 * DeepSeek provider adapter using OpenAI-compatible endpoint.
 */

import { createOpenAI } from '@ai-sdk/openai';
import type { ProviderAdapter, ProviderConfig } from '@coding-assistant/shared';

export const deepseekAdapter: ProviderAdapter = {
  id: 'deepseek',
  create: (config: ProviderConfig) => {
    return createOpenAI({
      apiKey: config.apiKey ?? process.env.DEEPSEEK_API_KEY,
      baseURL: config.baseUrl ?? 'https://api.deepseek.com/v1',
      ...config.options,
    });
  },
};
