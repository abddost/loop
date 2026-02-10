/**
 * Google provider adapter using @ai-sdk/google.
 */

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { ProviderAdapter, ProviderConfig } from '@coding-assistant/shared';

export const googleAdapter: ProviderAdapter = {
  id: 'google',
  create: (config: ProviderConfig) => {
    return createGoogleGenerativeAI({
      apiKey: config.apiKey ?? process.env.GOOGLE_API_KEY,
      baseURL: config.baseUrl,
      ...config.options,
    });
  },
};
