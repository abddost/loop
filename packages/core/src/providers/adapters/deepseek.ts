/**
 * DeepSeek provider adapter using OpenAI-compatible endpoint.
 *
 * In AI SDK v6 (@ai-sdk/openai v2), the default provider invocation uses the
 * Responses API. DeepSeek only supports Chat Completions, so we return
 * a model factory bound to provider.chat().
 */

import { createOpenAI } from '@ai-sdk/openai';
import type { ProviderAdapter, ProviderConfig } from '@coding-assistant/shared';

export const deepseekAdapter: ProviderAdapter = {
  id: 'deepseek',
  create: (config: ProviderConfig) => {
    const provider = createOpenAI({
      apiKey: config.apiKey ?? process.env.DEEPSEEK_API_KEY,
      baseURL: config.baseUrl ?? 'https://api.deepseek.com/v1',
      ...config.options,
    });
    // Return .chat() factory — forces Chat Completions API instead of Responses API
    return (modelId: string) => provider.chat(modelId);
  },
};
