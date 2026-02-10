/**
 * Cost Calculator -- estimates cost per step from token usage and model pricing.
 *
 * Uses a simple pricing table that can be expanded with models.dev data.
 * Returns costs in USD.
 */

import type { TokenUsage } from '@coding-assistant/shared';

/** Pricing per million tokens (input, output) in USD */
interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

/**
 * Default pricing table for common models.
 * TODO: Load dynamically from models.dev/api.json via the provider catalog.
 */
const PRICING_TABLE: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4o': { inputPerMillion: 2.50, outputPerMillion: 10.00 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  'gpt-4-turbo': { inputPerMillion: 10.00, outputPerMillion: 30.00 },
  'o1': { inputPerMillion: 15.00, outputPerMillion: 60.00 },
  'o1-mini': { inputPerMillion: 3.00, outputPerMillion: 12.00 },
  'o3-mini': { inputPerMillion: 1.10, outputPerMillion: 4.40 },

  // Anthropic
  'claude-4-sonnet': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  'claude-4-opus': { inputPerMillion: 15.00, outputPerMillion: 75.00 },
  'claude-3.5-sonnet': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  'claude-3.5-haiku': { inputPerMillion: 0.80, outputPerMillion: 4.00 },

  // Google
  'gemini-2.0-flash': { inputPerMillion: 0.10, outputPerMillion: 0.40 },
  'gemini-2.0-pro': { inputPerMillion: 1.25, outputPerMillion: 10.00 },
  'gemini-1.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5.00 },
  'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.30 },

  // DeepSeek
  'deepseek-chat': { inputPerMillion: 0.14, outputPerMillion: 0.28 },
  'deepseek-reasoner': { inputPerMillion: 0.55, outputPerMillion: 2.19 },
};

/** Default pricing if model not found */
const DEFAULT_PRICING: ModelPricing = {
  inputPerMillion: 3.00,
  outputPerMillion: 15.00,
};

/**
 * Look up pricing for a model ID.
 * Handles both "provider:model" format and plain model names.
 * Performs fuzzy matching (e.g., "gpt-4o-2024-08-06" matches "gpt-4o").
 */
function getPricing(modelId: string): ModelPricing {
  // Strip provider prefix
  const modelName = modelId.includes(':') ? modelId.split(':').slice(1).join(':') : modelId;

  // Exact match
  if (PRICING_TABLE[modelName]) return PRICING_TABLE[modelName];

  // Fuzzy match: check if the model starts with a known key
  for (const [key, pricing] of Object.entries(PRICING_TABLE)) {
    if (modelName.startsWith(key) || modelName.includes(key)) {
      return pricing;
    }
  }

  return DEFAULT_PRICING;
}

/**
 * Calculate the cost of a single step from its token usage.
 */
export function calculateStepCost(usage: TokenUsage | null, modelId: string): number {
  if (!usage) return 0;
  const pricing = getPricing(modelId);
  const inputCost = (usage.promptTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (usage.completionTokens / 1_000_000) * pricing.outputPerMillion;
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
