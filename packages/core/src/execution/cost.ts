/**
 * Cost Calculator -- estimates cost per step from token usage and model pricing.
 *
 * Pricing resolution order:
 * 1. Dynamic lookup from models.dev via the ModelCatalog (includes cache pricing)
 * 2. Fallback to a hardcoded table of known models
 * 3. Final fallback to a conservative default
 *
 * Returns costs in USD.
 */

import type { TokenUsage } from '@coding-assistant/shared';
import { modelCatalog } from '../providers/catalog.js';

// ── Types ─────────────────────────────────────────────────────────────────

/** Pricing per million tokens in USD. */
interface ResolvedPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion?: number;
  cacheWritePerMillion?: number;
}

// ── Hardcoded fallback table ──────────────────────────────────────────────

/**
 * Fallback pricing table for common models.
 * Used when the catalog hasn't loaded or doesn't have pricing for a model.
 */
const FALLBACK_PRICING: Record<string, ResolvedPricing> = {
  // OpenAI
  'gpt-4o':       { inputPerMillion: 2.50,  outputPerMillion: 10.00 },
  'gpt-4o-mini':  { inputPerMillion: 0.15,  outputPerMillion: 0.60 },
  'gpt-4-turbo':  { inputPerMillion: 10.00, outputPerMillion: 30.00 },
  'o1':           { inputPerMillion: 15.00, outputPerMillion: 60.00 },
  'o1-mini':      { inputPerMillion: 3.00,  outputPerMillion: 12.00 },
  'o3-mini':      { inputPerMillion: 1.10,  outputPerMillion: 4.40 },

  // Anthropic
  'claude-4-sonnet':  { inputPerMillion: 3.00,  outputPerMillion: 15.00, cacheReadPerMillion: 0.30, cacheWritePerMillion: 3.75 },
  'claude-4-opus':    { inputPerMillion: 15.00, outputPerMillion: 75.00, cacheReadPerMillion: 1.50, cacheWritePerMillion: 18.75 },
  'claude-3.5-sonnet':{ inputPerMillion: 3.00,  outputPerMillion: 15.00, cacheReadPerMillion: 0.30, cacheWritePerMillion: 3.75 },
  'claude-3.5-haiku': { inputPerMillion: 0.80,  outputPerMillion: 4.00,  cacheReadPerMillion: 0.08, cacheWritePerMillion: 1.00 },

  // Google
  'gemini-2.0-flash': { inputPerMillion: 0.10, outputPerMillion: 0.40 },
  'gemini-2.0-pro':   { inputPerMillion: 1.25, outputPerMillion: 10.00 },
  'gemini-1.5-pro':   { inputPerMillion: 1.25, outputPerMillion: 5.00 },
  'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.30 },

  // DeepSeek
  'deepseek-chat':     { inputPerMillion: 0.14, outputPerMillion: 0.28 },
  'deepseek-reasoner': { inputPerMillion: 0.55, outputPerMillion: 2.19 },
};

/** Conservative default when model is completely unknown. */
const DEFAULT_PRICING: ResolvedPricing = {
  inputPerMillion: 3.00,
  outputPerMillion: 15.00,
};

// ── Pricing resolution ────────────────────────────────────────────────────

/**
 * Resolve pricing for a model ID.
 *
 * 1. Try the live catalog (models.dev data) for the most accurate pricing
 * 2. Fall back to the hardcoded table with fuzzy matching
 * 3. Use the conservative default as last resort
 */
function resolvePricing(modelId: string): ResolvedPricing {
  // 1. Try catalog (dynamic, updated from models.dev)
  const catalogPricing = modelCatalog.getModelPricing(modelId);
  if (catalogPricing) {
    return {
      inputPerMillion: catalogPricing.inputPerMillion,
      outputPerMillion: catalogPricing.outputPerMillion,
      cacheReadPerMillion: catalogPricing.cacheReadPerMillion,
      cacheWritePerMillion: catalogPricing.cacheWritePerMillion,
    };
  }

  // 2. Fall back to hardcoded table with fuzzy matching
  const modelName = modelId.includes(':') ? modelId.split(':').slice(1).join(':') : modelId;

  // Exact match
  if (FALLBACK_PRICING[modelName]) return FALLBACK_PRICING[modelName];

  // Fuzzy: check if the model starts with or contains a known key
  for (const [key, pricing] of Object.entries(FALLBACK_PRICING)) {
    if (modelName.startsWith(key) || modelName.includes(key)) {
      return pricing;
    }
  }

  // 3. Conservative default
  return DEFAULT_PRICING;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Calculate the cost of a single step from its token usage.
 *
 * Supports cache-aware pricing: if the usage object includes
 * `cacheReadTokens` / `cacheWriteTokens`, those are priced at
 * the discounted cache rates when available.
 */
export function calculateStepCost(
  usage: TokenUsage | null,
  modelId: string,
): number {
  if (!usage) return 0;

  const pricing = resolvePricing(modelId);
  const inputCost  = (usage.inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;

  return inputCost + outputCost;
}

/**
 * Format a cost in USD for display (e.g., "$0.0042").
 */
export function formatCost(cost: number): string {
  if (cost < 0.001) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}
