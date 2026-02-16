/**
 * Build ToolExecCtx from workspace and session contexts.
 */

import type { ToolExecCtx } from './types.js';

/**
 * Build a tool execution context from the core context objects.
 * This bridges the core package's context with the tool interface.
 */
export function buildToolExecCtx(
  workspace: {
    id: string;
    rootPath: string;
    config: Record<string, unknown>;
    processManager: { spawn(cmd: string, args: string[], opts?: Record<string, unknown>): unknown };
  },
  session: {
    id: string;
    abortController: AbortController;
    fileReadTimestamps: Map<string, number>;
    getWriteLock(path: string): { acquire(): Promise<void>; release(): void };
    agentId?: string;
    isSubagent?: boolean;
  },
  options?: {
    sessionManager?: unknown;
    messageId?: string;
  },
): ToolExecCtx {
  return {
    workspaceId: workspace.id,
    workspaceRootPath: workspace.rootPath,
    sessionId: session.id,
    abort: session.abortController.signal,
    config: workspace.config as Record<string, unknown>,
    fileReadTimestamps: session.fileReadTimestamps,
    writeLock: async (path: string) => {
      const lock = session.getWriteLock(path);
      await lock.acquire();
      return { release: () => lock.release() };
    },
    processSpawn: (cmd, args, opts) => workspace.processManager.spawn(cmd, args, opts),
    workspaceRef: workspace,
    agentId: session.agentId,
    isSubagent: session.isSubagent,
    sessionManager: options?.sessionManager,
    messageId: options?.messageId,
  };
}
