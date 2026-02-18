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
    processManager: {
      spawn(cmd: string, args: string[], opts?: Record<string, unknown>): unknown;
      register(child: import('node:child_process').ChildProcess, command: string): void;
    };
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
    emitMetadata?: (metadata: Record<string, unknown>) => void;
    getShellEnv?: (cwd: string) => Record<string, string>;
  },
): ToolExecCtx {
  console.log('[buildToolExecCtx] workspace:', {
    id: workspace.id,
    rootPath: workspace.rootPath,
    hasConfig: !!workspace.config,
    configShell: (workspace.config as Record<string, unknown>)?.shell,
  });
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
    processRegister: (child, command) => workspace.processManager.register(child, command),
    workspaceRef: workspace,
    agentId: session.agentId,
    isSubagent: session.isSubagent,
    sessionManager: options?.sessionManager,
    messageId: options?.messageId,
    emitMetadata: options?.emitMetadata,
    getShellEnv: options?.getShellEnv,
  };
}
