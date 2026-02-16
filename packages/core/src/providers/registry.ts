/**
 * Provider registry -- manages provider adapters and caches factory instances.
 *
 * Each adapter's `create()` returns a `ProviderFactory` -- a function that
 * produces a LanguageModel for a given model ID. The registry caches these
 * factories by a composite key so identical configs reuse the same SDK instance.
 */

import type { ProviderAdapter, ProviderConfig, ProviderFactory } from '@coding-assistant/shared';
import { openaiAdapter } from './adapters/openai.js';
import { anthropicAdapter } from './adapters/anthropic.js';
import { googleAdapter } from './adapters/google.js';
import { deepseekAdapter } from './adapters/deepseek.js';
import { openaiCompatibleAdapter } from './adapters/openai-compatible.js';
import { openrouterAdapter } from './adapters/openrouter.js';

export class ProviderRegistry {
  private adapters = new Map<string, ProviderAdapter>();
  private instances = new Map<string, ProviderFactory>();

  constructor() {
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
   * Get or create a cached ProviderFactory for the given provider + config.
   *
   * The cache key includes apiKey, baseUrl, AND options so that different
   * SDK configurations (e.g. custom headers) get separate instances.
   */
  getProvider(providerId: string, config: ProviderConfig): ProviderFactory {
    const optionsHash = config.options ? JSON.stringify(config.options) : '';
    const cacheKey = `${providerId}:${config.apiKey ?? ''}:${config.baseUrl ?? ''}:${optionsHash}`;

    const cached = this.instances.get(cacheKey);
    if (cached) return cached;

    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      throw new Error(
        `Provider not found: ${providerId}. Available: ${Array.from(this.adapters.keys()).join(', ')}`,
      );
    }

    const factory = adapter.create(config);
    this.instances.set(cacheKey, factory);
    return factory;
  }

  /** List registered provider adapter IDs. */
  list(): string[] {
    return Array.from(this.adapters.keys());
  }
}

export const providerRegistry = new ProviderRegistry();
