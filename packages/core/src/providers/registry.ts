/**
 * Provider registry -- manages provider adapters.
 */

import type { ProviderAdapter, ProviderConfig } from '@coding-assistant/shared';
import { openaiAdapter } from './adapters/openai.js';
import { anthropicAdapter } from './adapters/anthropic.js';
import { googleAdapter } from './adapters/google.js';
import { deepseekAdapter } from './adapters/deepseek.js';
import { openaiCompatibleAdapter } from './adapters/openai-compatible.js';
import { openrouterAdapter } from './adapters/openrouter.js';

export class ProviderRegistry {
  private adapters = new Map<string, ProviderAdapter>();
  private instances = new Map<string, unknown>();

  constructor() {
    // Register built-in adapters
    this.register(openaiAdapter);
    this.register(anthropicAdapter);
    this.register(googleAdapter);
    this.register(deepseekAdapter);
    this.register(openaiCompatibleAdapter);
    this.register(openrouterAdapter);
  }

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  /**
   * Get or create a provider instance.
   */
  getProvider(providerId: string, config: ProviderConfig): unknown {
    const cacheKey = `${providerId}:${config.apiKey ?? ''}:${config.baseUrl ?? ''}`;

    if (this.instances.has(cacheKey)) {
      return this.instances.get(cacheKey);
    }

    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new Error(`Provider not found: ${providerId}. Available: ${Array.from(this.adapters.keys()).join(', ')}`);
    }

    const instance = adapter.create(config);
    this.instances.set(cacheKey, instance);
    return instance;
  }

  /**
   * List available provider IDs.
   */
  list(): string[] {
    return Array.from(this.adapters.keys());
  }
}

export const providerRegistry = new ProviderRegistry();
