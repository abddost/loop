/**
 * Generic OpenAI-compatible provider adapter.
 * Works with any provider that follows the OpenAI API format.
 *
 * In AI SDK v6 (@ai-sdk/openai v2), the default provider invocation uses the
 * Responses API. Generic compatible providers typically only support
 * Chat Completions, so we return a model factory bound to provider.chat().
 */

import { createOpenAI } from '@ai-sdk/openai';
import type { ProviderAdapter, ProviderConfig } from '@coding-assistant/shared';

export const openaiCompatibleAdapter: ProviderAdapter = {
  id: 'openai-compatible',
  create: (config: ProviderConfig) => {
    if (!config.baseUrl) {
      throw new Error('baseUrl is required for openai-compatible provider');
    }
    const provider = createOpenAI({
      apiKey: config.apiKey ?? '',
      baseURL: config.baseUrl,
      ...config.options,
    });
    // Return .chat() factory — forces Chat Completions API instead of Responses API
    return (modelId: string) => provider.chat(modelId);
  },
};
