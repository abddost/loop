/**
 * Tool definition types -- the runtime interfaces that all tools implement.
 *
 * `ToolExecCtx` is the flat execution context that every tool receives.
 * It is built from core's WorkspaceContext + SessionContext by the
 * `buildToolExecCtx()` adapter in ./context.ts.
 *
 * @see packages/shared/src/types/tool.ts -- ToolExecutionContext (nested reference type)
 * @see ./context.ts -- buildToolExecCtx (adapter from nested -> flat)
 */

import type { z } from 'zod';
import type { ToolCategory, RiskLevel } from '@coding-assistant/shared';

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<TInput>;
  category: ToolCategory;
  riskLevel: RiskLevel;
  execute: (input: TInput, ctx: ToolExecCtx) => Promise<ToolResult<TOutput>>;
}

/**
 * Flat execution context passed to tools at runtime.
 *
 * This is the canonical interface tool authors code against.
 * Built by `buildToolExecCtx()` from WorkspaceContext + SessionContext.
 */
export interface ToolExecCtx {
  workspaceId: string;
  workspaceRootPath: string;
  sessionId: string;
  abort: AbortSignal;
  config: Record<string, unknown>;
  fileReadTimestamps: Map<string, number>;
  writeLock: (path: string) => Promise<{ release(): void }>;
  processSpawn: (cmd: string, args: string[], opts?: Record<string, unknown>) => unknown;
}

export interface ToolResult<T = unknown> {
  result: T;
  metadata?: Record<string, unknown>;
}
