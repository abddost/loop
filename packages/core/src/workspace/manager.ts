/**
 * WorkspaceManager -- Top-level lifecycle container.
 *
 * Manages open/close of workspace contexts.
 */

import { generateWorkspaceId } from '@coding-assistant/shared';
import { configLoader } from '@coding-assistant/config';
import { WorkspaceContext } from './context.js';
import { detectGitState } from './git-state.js';
import { createFileWatcher } from './file-watcher.js';
import { ProcessManager } from './process-manager.js';
import { loadAgentInstructions } from './agent-instructions-loader.js';

export class WorkspaceManager implements Disposable {
  private workspaces = new Map<string, WorkspaceContext>();

  async open(rootPath: string): Promise<WorkspaceContext> {
    // Check if already open
    for (const ws of this.workspaces.values()) {
      if (ws.rootPath === rootPath) return ws;
    }

    const config = await configLoader.resolve(rootPath);
    const gitState = await detectGitState(rootPath);
    const instructions = await loadAgentInstructions(rootPath);
    const watcher = createFileWatcher(rootPath, config);
    const processManager = new ProcessManager();

    const ctx = new WorkspaceContext({
      id: generateWorkspaceId(),
      rootPath,
      config,
      agentInstructions: instructions,
      gitState,
      fileWatcher: watcher,
      processManager,
    });

    this.workspaces.set(ctx.id, ctx);
    return ctx;
  }

  async close(workspaceId: string): Promise<void> {
    const ctx = this.workspaces.get(workspaceId);
    if (ctx) {
      ctx[Symbol.dispose]();
      this.workspaces.delete(workspaceId);
    }
  }

  get(workspaceId: string): WorkspaceContext | undefined {
    return this.workspaces.get(workspaceId);
  }

  list(): WorkspaceContext[] {
    return Array.from(this.workspaces.values());
  }

  /** Shutdown: dispose all workspaces (process exit) */
  [Symbol.dispose](): void {
    for (const ctx of this.workspaces.values()) {
      ctx[Symbol.dispose]();
    }
    this.workspaces.clear();
  }
}
