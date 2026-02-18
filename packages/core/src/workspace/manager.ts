/**
 * WorkspaceManager -- Top-level lifecycle container.
 *
 * Manages open/close of workspace contexts.
 * Optionally persists workspace state to SQLite via WorkspaceRepository.
 */

import { generateWorkspaceId } from '@coding-assistant/shared';
import type { WorkspaceInfo } from '@coding-assistant/shared';
import { configLoader } from '../config/index.js';
import { WorkspaceContext } from './context.js';
import { detectGitState } from './git-state.js';
import { createFileWatcher } from './file-watcher.js';
import { ProcessManager } from './process-manager.js';
import { loadAgentInstructions } from './agent-instructions-loader.js';

/** Repository interface -- matches WorkspaceRepository from packages/server/persistence */
export interface WorkspaceRepo {
  create(workspace: WorkspaceInfo & { configJson?: string }): void;
  findByRootPath(rootPath: string): WorkspaceInfo | null;
  list(): WorkspaceInfo[];
  delete(id: string): void;
}

export class WorkspaceManager implements Disposable {
  private workspaces = new Map<string, WorkspaceContext>();
  private repo: WorkspaceRepo | null;

  constructor(repo?: WorkspaceRepo) {
    this.repo = repo ?? null;
  }

  /**
   * Open a workspace. If a workspace for `rootPath` is already open, returns it.
   * If a persisted workspace for `rootPath` exists, reuses its ID.
   * Otherwise creates a new workspace with a fresh ID and persists it.
   */
  async open(rootPath: string): Promise<WorkspaceContext> {
    // Check if already open in memory
    for (const ws of this.workspaces.values()) {
      if (ws.rootPath === rootPath) return ws;
    }

    // Check if a persisted workspace exists for this rootPath
    let persistedId: string | undefined;
    if (this.repo) {
      const existing = this.repo.findByRootPath(rootPath);
      if (existing) {
        persistedId = existing.id;
      }
    }

    const config = await configLoader.resolve(rootPath);
    const gitState = await detectGitState(rootPath);
    const instructions = await loadAgentInstructions(rootPath);
    const watcher = createFileWatcher(rootPath, config);
    const processManager = new ProcessManager();

    const ctx = new WorkspaceContext({
      id: persistedId ?? generateWorkspaceId(),
      rootPath,
      config,
      agentInstructions: instructions,
      gitState,
      fileWatcher: watcher,
      processManager,
    });

    this.workspaces.set(ctx.id, ctx);

    // Persist new workspace (skip if reusing persisted ID)
    if (!persistedId && this.repo) {
      try {
        this.repo.create({
          id: ctx.id,
          name: ctx.name,
          rootPath: ctx.rootPath,
          createdAt: ctx.createdAt,
        });
      } catch (err) {
        console.error(`[workspace-manager] Failed to persist workspace "${ctx.id}" (${ctx.rootPath}):`, err);
      }
    }

    return ctx;
  }

  async close(workspaceId: string): Promise<void> {
    const ctx = this.workspaces.get(workspaceId);
    if (ctx) {
      ctx[Symbol.dispose]();
      this.workspaces.delete(workspaceId);
      // Note: we do NOT delete from DB -- workspaces survive restarts.
      // The user explicitly opened this directory; it should be remembered.
    }
  }

  get(workspaceId: string): WorkspaceContext | undefined {
    return this.workspaces.get(workspaceId);
  }

  list(): WorkspaceContext[] {
    return Array.from(this.workspaces.values());
  }

  /**
   * Restore all persisted workspaces from the database.
   * Called during server startup before any requests are served.
   * Workspaces whose rootPath no longer exists are removed from the DB.
   */
  async restore(): Promise<void> {
    if (!this.repo) return;

    const persisted = this.repo.list();
    const results = await Promise.allSettled(
      persisted.map((info) => this.open(info.rootPath)),
    );

    // Clean up stale entries for workspaces that failed to restore
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        const info = persisted[i];
        console.warn(
          `[workspace-manager] Could not restore workspace "${info.rootPath}": ${result.reason}`,
        );
        // Directory may have been deleted -- remove stale entry
        try {
          this.repo.delete(info.id);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  /** Shutdown: dispose all workspaces (process exit) */
  [Symbol.dispose](): void {
    for (const ctx of this.workspaces.values()) {
      ctx[Symbol.dispose]();
    }
    this.workspaces.clear();
  }
}
