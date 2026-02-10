/**
 * Generic OpenAI-compatible provider adapter.
 * Works with any provider that follows the OpenAI API format.
 */

import { createOpenAI } from '@ai-sdk/openai';
import type { ProviderAdapter, ProviderConfig } from '@coding-assistant/shared';

export const openaiCompatibleAdapter: ProviderAdapter = {
  id: 'openai-compatible',
  create: (config: ProviderConfig) => {
    if (!config.baseUrl) {
      throw new Error('baseUrl is required for openai-compatible provider');
    }
    return createOpenAI({
      apiKey: config.apiKey ?? '',
      baseURL: config.baseUrl,
      ...config.options,
    });
  },
};
