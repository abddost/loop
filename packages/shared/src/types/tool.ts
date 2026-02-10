/**
 * Tool system types.
 */

import type { z } from 'zod';

export type ToolCategory =
  | 'file-read'
  | 'file-write'
  | 'search'
  | 'shell'
  | 'web'
  | 'task'
  | 'agent'
  | 'system';

export type RiskLevel = 'safe' | 'moderate' | 'dangerous';

/**
 * The contract every tool definition must implement.
 * TInput/TOutput are the Zod-inferred types.
 */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<TInput>;
  category: ToolCategory;
  riskLevel: RiskLevel;

  /** The tool receives the full context chain -- not raw strings */
  execute: (input: TInput, ctx: ToolExecutionContext) => Promise<ToolOutput<TOutput>>;

  /** Optional progress streaming callback */
  onProgress?: (
    input: TInput,
    ctx: ToolExecutionContext,
    emit: (update: ToolProgressUpdate) => void,
  ) => void;
}

/**
 * Derived at execution time from WorkspaceContext + SessionContext.
 * Never stored. Created fresh for each tool invocation.
 */
export interface ToolExecutionContext {
  /** Full workspace context: rootPath, gitState, config, processes */
  workspace: {
    id: string;
    rootPath: string;
    config: Record<string, unknown>;
    processManager: {
      spawn(command: string, args: string[], options?: Record<string, unknown>): unknown;
      killAll(): void;
    };
    gitState: {
      isRepo: boolean;
      branch: string | null;
      dirty: boolean;
    };
  };
  /** Full session context: permissionStore, writeLocks, fileReadTimestamps */
  session: {
    id: string;
    permissionStore: {
      findMatch(toolName: string, input: unknown): unknown | null;
    };
    writeLocks: Map<string, { acquire(): Promise<void>; release(): void }>;
    fileReadTimestamps: Map<string, number>;
  };
  /** Shorthand for session.abortController.signal */
  abort: AbortSignal;
}

export interface ToolOutput<T = unknown> {
  result: T;
  metadata?: {
    duration?: number;
    bytesRead?: number;
    bytesWritten?: number;
    [key: string]: unknown;
  };
}

export interface ToolProgressUpdate {
  type: 'progress';
  toolName: string;
  message: string;
  percentage?: number;
  data?: unknown;
}

/** AI SDK ToolSet compatible type */
export type ToolSet = Record<string, {
  inputSchema?: unknown;
  execute: (input: unknown) => Promise<unknown>;
  needsApproval?: (params: { input: unknown }) => Promise<boolean | string>;
}>;
