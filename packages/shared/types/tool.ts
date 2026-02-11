/**
 * Tool system types.
 *
 * NOTE ON CONTEXT TYPES:
 *
 * Two tool context types exist in this codebase:
 *
 * 1. `ToolExecutionContext` (this file) -- the full, nested context shape
 *    used as a reference/documentation type. It describes everything a tool
 *    *could* access about the workspace and session.
 *
 * 2. `ToolExecCtx` (packages/tools/src/types.ts) -- the flat, minimal context
 *    that tools actually receive at execution time. This is built by
 *    `buildToolExecCtx()` in packages/tools/src/context.ts, which maps
 *    from the core WorkspaceContext + SessionContext into the flat shape.
 *
 * All tool definitions use `ToolExecCtx`. The `ToolExecutionContext` here
 * is retained for type documentation and potential future use.
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
 *
 * Note: The actual tool definitions in packages/tools use the flat
 * `ToolExecCtx` rather than the nested `ToolExecutionContext` below.
 * See packages/tools/src/types.ts for the runtime interface.
 */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodSchema<TInput>;
  category: ToolCategory;
  riskLevel: RiskLevel;

  /** The tool receives the full context chain -- not raw strings */
  execute: (input: TInput, ctx: ToolExecutionContext) => Promise<ToolOutput<TOutput>>;
}

/**
 * Full nested context shape (reference type).
 *
 * In practice, tools receive the flat `ToolExecCtx` from packages/tools.
 * This type documents the full available context for reference.
 *
 * @see packages/tools/src/types.ts ToolExecCtx -- the runtime flat interface
 * @see packages/tools/src/context.ts buildToolExecCtx -- the adapter function
 */
export interface ToolExecutionContext {
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
  session: {
    id: string;
    permissionStore: {
      findMatch(toolName: string, input: unknown): unknown | null;
    };
    writeLocks: Map<string, { acquire(): Promise<void>; release(): void }>;
    fileReadTimestamps: Map<string, number>;
  };
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

/** AI SDK ToolSet compatible type */
export type ToolSet = Record<string, {
  inputSchema?: unknown;
  execute: (input: unknown) => Promise<unknown>;
  needsApproval?: (params: { input: unknown }) => Promise<boolean | string>;
}>;
