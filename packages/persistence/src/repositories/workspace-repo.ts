/**
 * Workspace persistence repository.
 */

import type Database from 'better-sqlite3';
import type { WorkspaceInfo } from '@coding-assistant/shared';

export class WorkspaceRepository {
  constructor(private db: Database.Database) {}

  create(workspace: WorkspaceInfo & { configJson?: string }): void {
    this.db.prepare(`
      INSERT INTO workspaces (id, name, rootPath, configJson, createdAt)
      VALUES (@id, @name, @rootPath, @configJson, @createdAt)
    `).run({
      id: workspace.id,
      name: workspace.name,
      rootPath: workspace.rootPath,
      configJson: workspace.configJson ?? '{}',
      createdAt: workspace.createdAt,
    });
  }

  findById(id: string): WorkspaceInfo | null {
    return this.db.prepare(`
      SELECT id, name, rootPath, createdAt FROM workspaces WHERE id = ?
    `).get(id) as WorkspaceInfo | null;
  }

  findByRootPath(rootPath: string): WorkspaceInfo | null {
    return this.db.prepare(`
      SELECT id, name, rootPath, createdAt FROM workspaces WHERE rootPath = ?
    `).get(rootPath) as WorkspaceInfo | null;
  }

  list(): WorkspaceInfo[] {
    return this.db.prepare(`
      SELECT id, name, rootPath, createdAt FROM workspaces ORDER BY createdAt DESC
    `).all() as WorkspaceInfo[];
  }

  updateConfig(id: string, configJson: string): void {
    this.db.prepare(`
      UPDATE workspaces SET configJson = ? WHERE id = ?
    `).run(configJson, id);
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM workspaces WHERE id = ?`).run(id);
  }
}
