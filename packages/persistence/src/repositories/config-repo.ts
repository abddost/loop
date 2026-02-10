/**
 * Config persistence -- stores workspace-level config overrides.
 */

import { BaseRepository } from './base-repo.js';

export class ConfigRepository extends BaseRepository {
  getWorkspaceConfig(workspaceId: string): Record<string, unknown> | null {
    const row = this.db.prepare(`
      SELECT configJson FROM workspaces WHERE id = ?
    `).get(workspaceId) as { configJson: string } | null;

    if (!row) return null;
    return this.parseJson<Record<string, unknown>>(row.configJson);
  }

  setWorkspaceConfig(workspaceId: string, config: Record<string, unknown>): void {
    this.db.prepare(`
      UPDATE workspaces SET configJson = ? WHERE id = ?
    `).run(this.toJson(config), workspaceId);
  }
}
