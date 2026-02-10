/**
 * Tool definition types (re-exports from shared with additions).
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
  onProgress?: (
    input: TInput,
    ctx: ToolExecCtx,
    emit: (update: ProgressUpdate) => void,
  ) => void;
}

/** Minimal execution context passed to tools */
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

export interface ProgressUpdate {
  type: 'progress';
  toolName: string;
  message: string;
  percentage?: number;
}
