/**
 * Config validation using Zod schema.
 */

import { configSchema } from './schema.js';
import type { ResolvedConfig } from '@coding-assistant/shared';

export interface ValidationResult {
  valid: boolean;
  config?: ResolvedConfig;
  errors?: string[];
}

export function validateConfig(data: unknown): ValidationResult {
  const result = configSchema.safeParse(data);

  if (result.success) {
    return {
      valid: true,
      config: result.data as ResolvedConfig,
    };
  }

  return {
    valid: false,
    errors: result.error.errors.map(
      (e) => `${e.path.join('.')}: ${e.message}`,
    ),
  };
}
