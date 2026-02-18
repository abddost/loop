/**
 * Workspace persistence repository.
 */

import type { WorkspaceInfo } from '@coding-assistant/shared';
import { BaseRepository } from './base-repo.js';

export class WorkspaceRepository extends BaseRepository {
  create(workspace: WorkspaceInfo & { configJson?: string }): void {
    this.stmt(`
      INSERT INTO workspaces (id, name, rootPath, configJson, createdAt)
      VALUES ($id, $name, $rootPath, $configJson, $createdAt)
    `).run({
      $id: workspace.id,
      $name: workspace.name,
      $rootPath: workspace.rootPath,
      $configJson: workspace.configJson ?? '{}',
      $createdAt: workspace.createdAt,
    });
  }

  findById(id: string): WorkspaceInfo | null {
    return this.stmt(`
      SELECT id, name, rootPath, createdAt FROM workspaces WHERE id = ?
    `).get(id) as WorkspaceInfo | null;
  }

  findByRootPath(rootPath: string): WorkspaceInfo | null {
    return this.stmt(`
      SELECT id, name, rootPath, createdAt FROM workspaces WHERE rootPath = ?
    `).get(rootPath) as WorkspaceInfo | null;
  }

  list(): WorkspaceInfo[] {
    return this.stmt(`
      SELECT id, name, rootPath, createdAt FROM workspaces ORDER BY createdAt DESC
    `).all() as WorkspaceInfo[];
  }

  updateConfig(id: string, configJson: string): void {
    this.stmt(`
      UPDATE workspaces SET configJson = ? WHERE id = ?
    `).run(configJson, id);
  }

  delete(id: string): void {
    this.stmt(`DELETE FROM workspaces WHERE id = ?`).run(id);
  }
}
