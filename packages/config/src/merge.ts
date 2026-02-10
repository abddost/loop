/**
 * Deep merge utility for config layers.
 * Later layers override earlier ones. Arrays are replaced, not concatenated.
 */

import type { ResolvedConfig, ConfigLayer } from '@coding-assistant/shared';
import { defaultConfig } from './defaults.js';

/**
 * Deep merge two objects. Arrays are replaced entirely by source.
 */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
): T {
  const result = { ...target };

  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceVal = source[key];
    const targetVal = target[key];

    if (sourceVal === undefined) continue;

    if (
      typeof sourceVal === 'object' &&
      sourceVal !== null &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === 'object' &&
      targetVal !== null &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      ) as T[keyof T];
    } else {
      result[key] = sourceVal as T[keyof T];
    }
  }

  return result;
}

/**
 * Merge multiple config layers in order.
 * Precedence: defaults < global < workspace < local < env < inline
 */
export function mergeConfigLayers(layers: ConfigLayer[]): ResolvedConfig {
  let result: ResolvedConfig = { ...defaultConfig };

  // Sort by precedence
  const precedence: Record<string, number> = {
    defaults: 0,
    global: 1,
    workspace: 2,
    local: 3,
    env: 4,
    inline: 5,
  };

  const sorted = [...layers].sort(
    (a, b) => (precedence[a.source] ?? 0) - (precedence[b.source] ?? 0),
  );

  for (const layer of sorted) {
    result = deepMerge(result, layer.data as Record<string, unknown>) as ResolvedConfig;
  }

  return result;
}
