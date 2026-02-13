/**
 * Model catalog -- fetches and normalizes model information from models.dev API.
 *
 * The models.dev dataset includes rich fields (capabilities, cost with cache
 * pricing, modalities, limits, family, status, etc.). This module extracts
 * ALL of that data into our typed `ModelInfo` / `ModelCapabilities` shapes
 * so downstream consumers (cost engine, transform layer, UI) get real values
 * instead of hardcoded defaults.
 */

import type {
  ProviderInfo,
  ModelInfo,
  ModelCapabilities,
  ModelPricing,
  ModalitySet,
  ProviderCatalogEntry,
  ProviderConnectionStatus,
  ProviderConfigEntry,
} from '@coding-assistant/shared';
import { getCredentialSchema } from './credential-schema.js';

// ── models.dev raw types ────────────────────────────────────────────────

interface ModelsDevModel {
  name: string;
  id: string;
  context_length?: number;
  max_output?: number;
  /** Pricing object -- models.dev uses various shapes */
  pricing?: { input: number; output: number; cache_read?: number; cache_write?: number };
  cost?: { input: number; output: number; cache_read?: number; cache_write?: number };
  /** Capability flags from models.dev */
  tool_call?: boolean;
  reasoning?: boolean;
  attachment?: boolean;
  temperature?: boolean;
  /** Modality arrays from models.dev */
  modalities?: {
    input?: string[];
    output?: string[];
  };
  /** Status (e.g. 'active', 'deprecated') */
  status?: string;
  /** Model family (e.g. 'gpt-4', 'claude-3') */
  family?: string;
}

interface ModelsDevEntry {
  name: string;
  provider: string;
  /** Can be an array OR an object keyed by model id -- models.dev varies */
  models?: ModelsDevModel[] | Record<string, ModelsDevModel>;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Safely extract models array from an entry.
 * models.dev sometimes returns an object keyed by model id instead of an array.
 */
function getModelsArray(entry: ModelsDevEntry): ModelsDevModel[] {
  if (!entry.models) return [];
  if (Array.isArray(entry.models)) return entry.models;
  if (typeof entry.models === 'object') {
    return Object.entries(entry.models).map(([key, val]) => {
      if (typeof val !== 'object' || val === null) {
        return { id: key, name: key } as ModelsDevModel;
      }
      return { ...val, id: val.id ?? key, name: val.name ?? key };
    });
  }
  return [];
}

/** Parse a modality array (e.g. ['text', 'image']) into our ModalitySet. */
function parseModalities(modalities?: string[]): ModalitySet {
  const set: ModalitySet = { text: true, image: false, audio: false, video: false, pdf: false };
  if (!modalities) return set;
  for (const m of modalities) {
    const lower = m.toLowerCase();
    if (lower === 'image') set.image = true;
    else if (lower === 'audio') set.audio = true;
    else if (lower === 'video') set.video = true;
    else if (lower === 'pdf') set.pdf = true;
  }
  return set;
}

/** Extract real capabilities from models.dev fields, with sensible defaults. */
function buildCapabilities(model: ModelsDevModel): ModelCapabilities {
  const inputModalities = parseModalities(model.modalities?.input);
  const outputModalities = parseModalities(model.modalities?.output);

  return {
    streaming: true,
    functionCalling: model.tool_call ?? true,
    vision: inputModalities.image,
    reasoning: model.reasoning ?? false,
    json: true,
    attachment: model.attachment ?? inputModalities.image,
    temperature: model.temperature ?? true,
    input: inputModalities,
    output: outputModalities,
  };
}

/** Extract pricing, checking both `pricing` and `cost` fields from models.dev. */
function buildPricing(model: ModelsDevModel): ModelPricing | undefined {
  const raw = model.pricing ?? model.cost;
  if (!raw) return undefined;

  return {
    inputPerMillion: raw.input,
    outputPerMillion: raw.output,
    cacheReadPerMillion: raw.cache_read,
    cacheWritePerMillion: raw.cache_write,
    currency: 'USD',
  };
}

/** Convert a raw models.dev model + provider key into our ModelInfo. */
function toModelInfo(providerKey: string, model: ModelsDevModel): ModelInfo {
  return {
    id: `${providerKey}:${model.id}`,
    providerId: providerKey,
    name: model.name,
    description: '',
    limits: {
      context: model.context_length ?? 128_000,
      maxOutput: model.max_output ?? 16_384,
    },
    capabilities: buildCapabilities(model),
    pricing: buildPricing(model),
  };
}

// ── ModelCatalog ────────────────────────────────────────────────────────

export class ModelCatalog {
  private data: Record<string, ModelsDevEntry> = {};
  private lastRefresh = 0;
  private refreshIntervalMs = 24 * 60 * 60 * 1000; // 24 hours

  /** Refresh the catalog from models.dev API. */
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

  /** Check if catalog needs refresh. */
  get needsRefresh(): boolean {
    return Date.now() - this.lastRefresh > this.refreshIntervalMs;
  }

  /**
   * Find a model by query string (e.g., "openai:gpt-4o" or "gpt-4o").
   * Returns fully-typed ModelInfo with real capabilities and pricing.
   */
  findModel(query: string): ModelInfo | null {
    const [providerId, modelName] = query.includes(':')
      ? query.split(':', 2)
      : ['', query];

    for (const [key, entry] of Object.entries(this.data)) {
      if (providerId && key !== providerId && entry.provider !== providerId) continue;

      for (const model of getModelsArray(entry)) {
        if (model.id === modelName || model.name === modelName || model.id === query) {
          return toModelInfo(key, model);
        }
      }
    }

    return null;
  }

  /**
   * Get pricing for a model by ID.
   * Used by the cost engine as a dynamic pricing source.
   */
  getModelPricing(modelId: string): ModelPricing | null {
    const info = this.findModel(modelId);
    return info?.pricing ?? null;
  }

  /** Suggest similar model names for typo correction. */
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

  /** List all available providers with real model data. */
  listProviders(): ProviderInfo[] {
    return Object.entries(this.data).map(([key, entry]) => ({
      id: key,
      name: entry.name,
      description: '',
      website: '',
      models: getModelsArray(entry).map((m) => toModelInfo(key, m)),
    }));
  }

  /**
   * Build catalog entries for the settings UI by merging:
   * 1. models.dev provider list (names, model counts)
   * 2. Credential schemas from credential-schema.ts
   * 3. Connection statuses from the caller
   * 4. Popular tier tagging
   *
   * @param oauthProviderIds -- optional set of provider IDs authenticated via
   *        OAuth (auth.json). When present, these are treated as "configured"
   *        even if they have no entry in `providerConfigs` (config.json).
   */
  getProviderCatalogEntries(
    providerConfigs: Record<string, ProviderConfigEntry>,
    connectionStatuses: Record<string, ProviderConnectionStatus>,
    oauthProviderIds?: Set<string>,
  ): ProviderCatalogEntry[] {
    const entries: ProviderCatalogEntry[] = [];

    for (const [key, entry] of Object.entries(this.data)) {
      const hasConfig =
        Boolean(providerConfigs[key]) || (oauthProviderIds?.has(key) ?? false);
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
        const hasConfig =
          Boolean(providerConfigs[id]) || (oauthProviderIds?.has(id) ?? false);
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
