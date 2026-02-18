/**
 * Session persistence repository.
 */

import type { SessionInfo, SessionStatus } from '@coding-assistant/shared';
import { BaseRepository } from './base-repo.js';

export class SessionRepository extends BaseRepository {
  create(session: SessionInfo): void {
    this.stmt(`
      INSERT INTO sessions (id, workspaceId, title, status, agentId, parentSessionId, forkMessageIndex, summaryText, configOverridesJson, createdAt, updatedAt)
      VALUES ($id, $workspaceId, $title, $status, $agentId, $parentSessionId, $forkMessageIndex, $summaryText, $configOverridesJson, $createdAt, $updatedAt)
    `).run({
      $id: session.id,
      $workspaceId: session.workspaceId,
      $title: session.title,
      $status: session.status,
      $agentId: session.agentId,
      $parentSessionId: session.parentSessionId,
      $forkMessageIndex: session.forkMessageIndex,
      $summaryText: session.summaryText,
      $configOverridesJson: null,
      $createdAt: session.createdAt,
      $updatedAt: session.updatedAt,
    });
  }

  findById(id: string): SessionInfo | null {
    return this.stmt(`
      SELECT id, workspaceId, title, status, agentId, parentSessionId, forkMessageIndex, summaryText, createdAt, updatedAt
      FROM sessions WHERE id = ?
    `).get(id) as SessionInfo | null;
  }

  listByWorkspace(workspaceId: string): SessionInfo[] {
    return this.stmt(`
      SELECT id, workspaceId, title, status, agentId, parentSessionId, forkMessageIndex, summaryText, createdAt, updatedAt
      FROM sessions WHERE workspaceId = ? ORDER BY updatedAt DESC
    `).all(workspaceId) as SessionInfo[];
  }

  updateStatus(id: string, status: SessionStatus): void {
    this.stmt(`
      UPDATE sessions SET status = ?, updatedAt = datetime('now') WHERE id = ?
    `).run(status, id);
  }

  updateTitle(id: string, title: string): void {
    this.stmt(`
      UPDATE sessions SET title = ?, updatedAt = datetime('now') WHERE id = ?
    `).run(title, id);
  }

  updateSummary(id: string, summaryText: string): void {
    this.stmt(`
      UPDATE sessions SET summaryText = ?, updatedAt = datetime('now') WHERE id = ?
    `).run(summaryText, id);
  }

  delete(id: string): void {
    this.stmt(`DELETE FROM sessions WHERE id = ?`).run(id);
  }
}
