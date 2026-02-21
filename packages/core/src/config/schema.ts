/**
 * Zod schema for configuration validation.
 */

import { z } from 'zod';

const permissionActionSchema = z.enum(['allow', 'ask', 'deny']);
const permissionRuleSchema = z.union([
  permissionActionSchema,
  z.record(z.string(), permissionActionSchema),
]);
const permissionSchema = z.record(z.string(), permissionRuleSchema).default({});


const providerConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  options: z.record(z.unknown()).optional(),
});

const shellConfigSchema = z.object({
  defaultShell: z.string().default('/bin/bash'),
  timeout: z.number().default(120_000),
});

const contextConfigSchema = z.object({
  budgetRatio: z.number().min(0).max(1).default(0.85),
  autoCompact: z.boolean().default(true),
  protectedPatterns: z.array(z.string()).default([]),
});

const uiConfigSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  fontSize: z.number().min(8).max(32).default(14),
  streaming: z.boolean().default(true),
});

export const configSchema = z.object({
  defaultModel: z.string().default('openai:gpt-4o'),
  providers: z.record(providerConfigSchema).default({}),
  enabledModels: z.array(z.string()).default([]),
  permissions: permissionSchema.default({}),
  shell: shellConfigSchema.default({}),
  context: contextConfigSchema.default({}),
  ui: uiConfigSchema.default({}),
  metadata: z.record(z.unknown()).default({}),
});

export type ConfigSchema = z.infer<typeof configSchema>;
