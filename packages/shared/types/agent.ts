/**
 * Agent system types.
 */

import type { ToolCategory } from './tool.js';
import type { PermissionRuleset } from './permission.js';

export type AgentId = 'build' | 'plan' | 'explore' | 'summarize' | 'title' | string;

export interface AgentProfile {
  id: AgentId;
  name: string;
  description: string;
  systemPrompt: string;
  toolPolicy: AgentToolPolicy;
  /** Flat permission ruleset (rule-based system). */
  permission: PermissionRuleset;
  model: string | undefined;
  maxSteps: number;
  maxOutputTokens?: number;
  temperature?: number;

  /** @deprecated Use `permission` instead. Kept for migration compatibility. */
  permissionProfile?: Record<string, PermissionMode>;
}

export interface AgentToolPolicy {
  allowed: ToolCategory[];
  denied: ToolCategory[];
}

export type PermissionMode = 'allow' | 'ask' | 'deny';

export interface AgentInstructions {
  /** Raw content from AGENTS.md files */
  content: string;
  /** Source file path */
  source: string;
}
