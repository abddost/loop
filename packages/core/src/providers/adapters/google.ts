/**
 * Google provider adapter using @ai-sdk/google.
 *
 * Returns a ProviderFactory that creates LanguageModel instances via
 * `provider.languageModel()`, the correct API surface for Google/Gemini
 * models in AI SDK v6.
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { ProviderAdapter, ProviderConfig } from '@coding-assistant/shared';

export const googleAdapter: ProviderAdapter = {
  id: 'google',
  create: (config: ProviderConfig) => {
    const provider = createGoogleGenerativeAI({
      apiKey: config.apiKey ?? process.env.GOOGLE_API_KEY,
      baseURL: config.baseUrl,
      ...config.options,
    });
    return (modelId: string) => provider.languageModel(modelId);
  },
};
