/**
 * Config persistence -- stores workspace-level config overrides.
 */

import type Database from 'better-sqlite3';

export class ConfigRepository {
  constructor(private db: Database.Database) {}

  getWorkspaceConfig(workspaceId: string): Record<string, unknown> | null {
    const row = this.db.prepare(`
      SELECT configJson FROM workspaces WHERE id = ?
    `).get(workspaceId) as { configJson: string } | undefined;

    if (!row) return null;
    return JSON.parse(row.configJson);
  }

  setWorkspaceConfig(workspaceId: string, config: Record<string, unknown>): void {
    this.db.prepare(`
      UPDATE workspaces SET configJson = ? WHERE id = ?
    `).run(JSON.stringify(config), workspaceId);
  }
}
