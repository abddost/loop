/**
 * Default configuration values.
 */

import type { ResolvedConfig } from '@coding-assistant/shared';

export const defaultConfig: ResolvedConfig = {
  defaultModel: 'openai:gpt-4o',
  providers: {},
  permissions: {},
  shell: {
    defaultShell: '/bin/bash',
    timeout: 120_000,
  },
  context: {
    budgetRatio: 0.85,
    autoCompact: true,
    protectedPatterns: [],
  },
  ui: {
    theme: 'system',
    fontSize: 14,
    streaming: true,
  },
  enabledModels: [],
  metadata: {},
};
