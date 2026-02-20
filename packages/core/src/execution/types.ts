/**
 * Shared types for the execution module.
 *
 * Defines the ExecutionDeps interface (dependency injection container),
 * StepResult enum, and scope types used across all extracted modules.
 */

import type {
  StreamEvent,
  ProviderConfig,
  ToolCategory,
} from '@coding-assistant/shared';
import type { RawStreamEvent } from './stream-mapper.js';

// ── AI SDK types (compile-time only) ─────────────────────────────────────

import type {
  streamText as StreamTextFn,
  LanguageModel,
  ToolSet,
} from 'ai';

// ── Dependency Injection ─────────────────────────────────────────────────

export interface ExecutionDeps {
  streamText: typeof StreamTextFn;
  agentRegistry: {
    resolve(id: string): import('@coding-assistant/shared').AgentProfile;
  };
  resolveModel: (
    modelString: string,
    providerConfigs: Record<string, ProviderConfig>,
  ) => {
    providerId: string;
    modelId: string;
    provider: (modelId: string) => LanguageModel;
    info?: { limits?: { context?: number }; [key: string]: unknown };
  };
  toolRegistry: {
    toAISDKTools(
      ctx: unknown,
      opts: { categories: ToolCategory[] },
    ): ToolSet;
  };
  buildToolExecCtx: (
    workspace: {
      id: string;
      rootPath: string;
      config: Record<string, unknown>;
      processManager: unknown;
    },
    session: unknown,
    extra: {
      sessionManager: unknown;
      messageId: string;
      emitMetadata: (metadata: Record<string, unknown>) => void;
      getShellEnv: (cwd: string) => Record<string, string> | Promise<Record<string, string>>;
      ask?: (input: { permission: string; patterns: string[]; always: string[]; metadata: Record<string, unknown> }) => Promise<void>;
    },
  ) => unknown;
  buildSystemPrompt: (agent: import('@coding-assistant/shared').AgentProfile, instructions: unknown) => string;

  // ── Permission (rule-based) ────────────────────────────────────────
  Permission: typeof import('../permissions/permission.js').Permission;
  defaultPermissionRules: import('../permissions/permission.js').Permission.Ruleset;

  summarizeAgent: import('@coding-assistant/shared').AgentProfile;
  readAuthStore: () => Promise<Record<string, { type: string; metadata?: unknown }>>;
  isTokenExpired: (auth: unknown) => boolean;
  buildOAuthFetch: (providerId: string, getToken: () => Promise<string>) => typeof fetch;
  makeTokenProvider: (providerId: string) => () => Promise<string>;
  getOAuthBaseUrl: (providerId: string, metadata: unknown) => string | undefined;
}

// ── Scope ────────────────────────────────────────────────────────────

export interface StepScope {
  workspaceId: string;
  sessionId: string;
  messageId: string;
}

// ── Step Result ──────────────────────────────────────────────────────

export type StepResult = 'continue' | 'stop' | 'doom-loop';

// ── Execution Input ──────────────────────────────────────────────────

export interface ExecutionInput {
  content: string;
  model?: string;
  effort?: string;
  attachments?: Array<{ type: string; data: string }>;
  registerPermissionRequest?: (
    requestId: string,
    workspaceId: string,
    sessionId: string,
  ) => Promise<{ granted: boolean; mode?: 'once' | 'always'; feedback?: string }>;
}
