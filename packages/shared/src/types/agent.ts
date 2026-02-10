/**
 * Agent system types.
 */

import type { ToolCategory } from './tool.js';

export type AgentId = 'build' | 'plan' | 'explore' | 'summarize' | 'title' | string;

export interface AgentProfile {
  id: AgentId;
  name: string;
  description: string;
  systemPrompt: string;
  toolPolicy: AgentToolPolicy;
  permissionProfile: Record<string, PermissionMode>;
  model: string | undefined;
  maxSteps: number;
  maxOutputTokens?: number;
  temperature?: number;
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
