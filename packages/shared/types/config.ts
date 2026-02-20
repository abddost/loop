/**
 * Configuration types.
 */

import type { PermissionConfig, PermissionPolicy } from './permission.js';

export interface ResolvedConfig {
  /** Default model ID (e.g., "openai:gpt-4o") */
  defaultModel: string;

  /** Provider configurations */
  providers: Record<string, ProviderConfigEntry>;

  /** Permission rules (flat config format). Also accepts legacy PermissionPolicy for compat. */
  permissions: PermissionConfig | PermissionPolicy;

  /** Shell configuration */
  shell: ShellConfig;

  /** Context management */
  context: ContextConfig;

  /** UI preferences */
  ui: UIConfig;

  /** Explicitly enabled model IDs (e.g. ['openai:gpt-4o', 'anthropic:claude-4-sonnet']) */
  enabledModels: string[];

  /** Custom metadata */
  metadata: Record<string, unknown>;
}

export interface ProviderConfigEntry {
  apiKey?: string;
  baseUrl?: string;
  options?: Record<string, unknown>;
}

export interface ShellConfig {
  /** Default shell to use */
  defaultShell: string;
  /** Commands that are always allowed without permission */
  allowedCommands: string[];
  /** Commands that are always denied */
  deniedCommands: string[];
  /** Max execution time in ms */
  timeout: number;
}

export interface ContextConfig {
  /** Maximum context budget ratio (0-1) */
  budgetRatio: number;
  /** Enable automatic compaction */
  autoCompact: boolean;
  /** Protected patterns (never pruned) */
  protectedPatterns: string[];
}

export interface UIConfig {
  /** Theme preference */
  theme: 'light' | 'dark' | 'system';
  /** Font size */
  fontSize: number;
  /** Enable streaming display */
  streaming: boolean;
}

/** Represents a single layer of config before merging */
export interface ConfigLayer {
  source: ConfigSource;
  path?: string;
  data: Partial<ResolvedConfig>;
}

export type ConfigSource =
  | 'defaults'
  | 'global'
  | 'workspace'
  | 'local'
  | 'env'
  | 'inline';
