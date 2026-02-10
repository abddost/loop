/**
 * Model catalog -- fetches model information from models.dev API.
 */

import type {
  ProviderInfo,
  ModelInfo,
  ProviderCatalogEntry,
  ProviderConnectionStatus,
  ProviderConfigEntry,
} from '@coding-assistant/shared';
import { getCredentialSchema } from './credential-schema.js';

interface ModelsDevModel {
  name: string;
  id: string;
  context_length?: number;
  max_output?: number;
  pricing?: { input: number; output: number };
}

interface ModelsDevEntry {
  name: string;
  provider: string;
  /** Can be an array OR an object keyed by model id -- models.dev varies */
  models?: ModelsDevModel[] | Record<string, ModelsDevModel>;
}

/**
 * Safely extract models array from an entry.
 * models.dev sometimes returns an object keyed by model id instead of an array.
 */
function getModelsArray(entry: ModelsDevEntry): ModelsDevModel[] {
  if (!entry.models) return [];
  if (Array.isArray(entry.models)) return entry.models;
  if (typeof entry.models === 'object') {
    return Object.entries(entry.models).map(([key, val]) => {
      // If val is a primitive or missing id, synthesize from key
      if (typeof val !== 'object' || val === null) {
        return { id: key, name: key } as ModelsDevModel;
      }
      return { ...val, id: val.id ?? key, name: val.name ?? key };
    });
  }
  return [];
}

export class ModelCatalog {
  private data: Record<string, ModelsDevEntry> = {};
  private lastRefresh = 0;
  private refreshIntervalMs = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Refresh the catalog from models.dev API.
   */
  async refresh(): Promise<void> {
    try {
      const resp = await fetch('https://models.dev/api.json');
      if (resp.ok) {
        this.data = await resp.json();
        this.lastRefresh = Date.now();
      }
    } catch (err) {
      console.warn('Failed to refresh model catalog:', err);
    }
  }

  /**
   * Check if catalog needs refresh.
   */
  get needsRefresh(): boolean {
    return Date.now() - this.lastRefresh > this.refreshIntervalMs;
  }

  /**
   * Find a model by query string (e.g., "openai:gpt-4o").
   */
  findModel(query: string): ModelInfo | null {
    const [providerId, modelName] = query.includes(':')
      ? query.split(':', 2)
      : ['', query];

    for (const [key, entry] of Object.entries(this.data)) {
      if (providerId && key !== providerId && entry.provider !== providerId) continue;

      for (const model of getModelsArray(entry)) {
        if (model.id === modelName || model.name === modelName || model.id === query) {
          return {
            id: `${key}:${model.id}`,
            providerId: key,
            name: model.name,
            description: '',
            limits: {
              context: model.context_length ?? 128000,
              maxOutput: model.max_output ?? 16384,
            },
            capabilities: {
              streaming: true,
              functionCalling: true,
              vision: false,
              reasoning: false,
              json: true,
            },
            pricing: model.pricing ? {
              inputPerMillion: model.pricing.input,
              outputPerMillion: model.pricing.output,
              currency: 'USD',
            } : undefined,
          };
        }
      }
    }

    return null;
  }

  /**
   * Suggest similar model names for typo correction.
   */
  suggestSimilar(unknownId: string): string[] {
    const suggestions: string[] = [];
    const lower = unknownId.toLowerCase();

    for (const [key, entry] of Object.entries(this.data)) {
      for (const model of getModelsArray(entry)) {
        const fullId = `${key}:${model.id}`;
        if (fullId.toLowerCase().includes(lower) || lower.includes(model.id.toLowerCase())) {
          suggestions.push(fullId);
        }
      }
    }

    return suggestions.slice(0, 5);
  }

  /**
   * List all available providers.
   */
  listProviders(): ProviderInfo[] {
    return Object.entries(this.data).map(([key, entry]) => ({
      id: key,
      name: entry.name,
      description: '',
      website: '',
      models: getModelsArray(entry).map((m) => ({
        id: `${key}:${m.id}`,
        providerId: key,
        name: m.name,
        description: '',
        limits: {
          context: m.context_length ?? 128000,
          maxOutput: m.max_output ?? 16384,
        },
        capabilities: {
          streaming: true,
          functionCalling: true,
          vision: false,
          reasoning: false,
          json: true,
        },
      })),
    }));
  }

  /**
   * Build catalog entries for the settings UI by merging:
   * 1. models.dev provider list (names, model counts)
   * 2. Credential schemas from credential-schema.ts
   * 3. Connection statuses from the caller
   * 4. Popular tier tagging
   */
  getProviderCatalogEntries(
    providerConfigs: Record<string, ProviderConfigEntry>,
    connectionStatuses: Record<string, ProviderConnectionStatus>,
  ): ProviderCatalogEntry[] {
    const entries: ProviderCatalogEntry[] = [];

    for (const [key, entry] of Object.entries(this.data)) {
      const hasConfig = Boolean(providerConfigs[key]);
      const status = connectionStatuses[key]
        ?? (hasConfig ? 'untested' as const : 'disconnected' as const);

      entries.push({
        id: key,
        name: entry.name,
        description: '',
        website: '',
        tier: POPULAR_PROVIDER_IDS.has(key) ? 'popular' : 'other',
        credentialFields: getCredentialSchema(key),
        connectionStatus: status,
        modelCount: getModelsArray(entry).length,
      });
    }

    // Ensure popular providers appear even if not in models.dev data
    for (const id of POPULAR_PROVIDER_IDS) {
      if (!entries.find((e) => e.id === id)) {
        const hasConfig = Boolean(providerConfigs[id]);
        const status = connectionStatuses[id]
          ?? (hasConfig ? 'untested' as const : 'disconnected' as const);

        entries.push({
          id,
          name: POPULAR_PROVIDER_NAMES[id] ?? id,
          description: '',
          website: '',
          tier: 'popular',
          credentialFields: getCredentialSchema(id),
          connectionStatus: status,
          modelCount: 0,
        });
      }
    }

    return entries;
  }
}

/** Provider IDs that are shown prominently in the "Popular" section */
const POPULAR_PROVIDER_IDS = new Set([
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'vercel-ai-gateway',
]);

/** Display names for popular providers that may not be in models.dev */
const POPULAR_PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  openrouter: 'OpenRouter',
  'vercel-ai-gateway': 'Vercel AI Gateway',
};

export const modelCatalog = new ModelCatalog();
