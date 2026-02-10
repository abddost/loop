/**
 * Anthropic provider adapter using @ai-sdk/anthropic.
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import type { ProviderAdapter, ProviderConfig } from '@coding-assistant/shared';

export const anthropicAdapter: ProviderAdapter = {
  id: 'anthropic',
  create: (config: ProviderConfig) => {
    return createAnthropic({
      apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY,
      baseURL: config.baseUrl,
      ...config.options,
    });
  },
};
