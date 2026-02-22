/**
 * Message and MessagePart persistence repository.
 *
 * Uses a two-query pattern (messages + parts separately) instead of
 * LEFT JOIN to avoid row explosion. Matches opencode's approach.
 */

import type { Message, MessagePart, TokenUsage, MessageError } from '@coding-assistant/shared';
import { BaseRepository } from './base-repo.js';

interface MessageRow {
  id: string;
  sessionId: string;
  role: string;
  index: number;
  modelId: string | null;
  finishReason: string | null;
  usageJson: string | null;
  errorJson: string | null;
  createdAt: string;
}

interface PartRow {
  id: string;
  messageId: string;
  sessionId: string | null;
  index: number;
  type: string;
  dataJson: string;
  createdAt: string;
}

export class MessageRepository extends BaseRepository {
  createMessage(message: Omit<Message, 'parts'>): void {
    this.stmt(`
      INSERT INTO messages (id, sessionId, role, "index", modelId, finishReason, usageJson, errorJson, createdAt)
      VALUES ($id, $sessionId, $role, $index, $modelId, $finishReason, $usageJson, $errorJson, $createdAt)
    `).run({
      $id: message.id,
      $sessionId: message.sessionId,
      $role: message.role,
      $index: message.index,
      $modelId: message.modelId,
      $finishReason: message.finishReason,
      $usageJson: this.toJson(message.usage),
      $errorJson: this.toJson(message.error),
      $createdAt: message.createdAt,
    });
  }

  addPart(part: MessagePart & { messageId: string; sessionId?: string }): void {
    this.stmt(`
      INSERT OR REPLACE INTO message_parts (id, messageId, sessionId, "index", type, dataJson, createdAt)
      VALUES ($id, $messageId, $sessionId, $index, $type, $dataJson, $createdAt)
    `).run({
      $id: part.id,
      $messageId: part.messageId,
      $sessionId: part.sessionId ?? null,
      $index: part.index,
      $type: part.type,
      $dataJson: this.toJson(part),
      $createdAt: new Date().toISOString(),
    });
  }

  /**
   * Load all messages for a session with their parts using two separate queries.
   *
   * Two-query pattern eliminates the LEFT JOIN row explosion:
   * - Query 1: all messages for the session
   * - Query 2: all parts for the session (via denormalized sessionId)
   * - Group parts by messageId in memory
   */
  getSessionMessages(sessionId: string): Message[] {
    const messageRows = this.stmt(`
      SELECT id, sessionId, role, "index", modelId, finishReason, usageJson, errorJson, createdAt
      FROM messages WHERE sessionId = ? ORDER BY "index" ASC
    `).all(sessionId) as MessageRow[];

    if (messageRows.length === 0) return [];

    const partRows = this.stmt(`
      SELECT id, messageId, sessionId, "index", type, dataJson, createdAt
      FROM message_parts WHERE sessionId = ? ORDER BY messageId, "index" ASC
    `).all(sessionId) as PartRow[];

    // Group parts by messageId
    const partsByMessage = new Map<string, MessagePart[]>();
    for (const row of partRows) {
      const part = this.parseJson<MessagePart>(row.dataJson);
      if (!part) continue;
      let parts = partsByMessage.get(row.messageId);
      if (!parts) {
        parts = [];
        partsByMessage.set(row.messageId, parts);
      }
      parts.push(part);
    }

    return messageRows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      role: row.role as Message['role'],
      index: row.index,
      modelId: row.modelId,
      finishReason: row.finishReason as Message['finishReason'],
      usage: this.parseJson<TokenUsage>(row.usageJson),
      error: this.parseJson<MessageError>(row.errorJson),
      parts: partsByMessage.get(row.id) ?? [],
      createdAt: row.createdAt,
    }));
  }

  /**
   * Load paginated messages for a session with their parts.
   * Uses two separate queries instead of a subquery + JOIN.
   */
  getSessionMessagesPaginated(
    sessionId: string,
    limit: number,
    offset: number,
  ): { messages: Message[]; total: number; hasMore: boolean } {
    const { total } = this.stmt(
      `SELECT COUNT(*) AS total FROM messages WHERE sessionId = ?`,
    ).get(sessionId) as { total: number };

    const messageRows = this.stmt(`
      SELECT id, sessionId, role, "index", modelId, finishReason, usageJson, errorJson, createdAt
      FROM messages WHERE sessionId = ? ORDER BY "index" ASC LIMIT ? OFFSET ?
    `).all(sessionId, limit, offset) as MessageRow[];

    if (messageRows.length === 0) {
      return { messages: [], total, hasMore: offset + limit < total };
    }

    // Fetch parts using cached sessionId-based query, then filter in memory
    // to only parts belonging to paginated messages (avoids uncacheable IN clause)
    const messageIdSet = new Set(messageRows.map((r) => r.id));
    const allPartRows = this.stmt(`
      SELECT id, messageId, sessionId, "index", type, dataJson, createdAt
      FROM message_parts WHERE sessionId = ? ORDER BY messageId, "index" ASC
    `).all(sessionId) as PartRow[];

    // Group parts by messageId (only for paginated messages)
    const partsByMessage = new Map<string, MessagePart[]>();
    for (const row of allPartRows) {
      if (!messageIdSet.has(row.messageId)) continue;
      const part = this.parseJson<MessagePart>(row.dataJson);
      if (!part) continue;
      let parts = partsByMessage.get(row.messageId);
      if (!parts) {
        parts = [];
        partsByMessage.set(row.messageId, parts);
      }
      parts.push(part);
    }

    const messages = messageRows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      role: row.role as Message['role'],
      index: row.index,
      modelId: row.modelId,
      finishReason: row.finishReason as Message['finishReason'],
      usage: this.parseJson<TokenUsage>(row.usageJson),
      error: this.parseJson<MessageError>(row.errorJson),
      parts: partsByMessage.get(row.id) ?? [],
      createdAt: row.createdAt,
    }));

    return { messages, total, hasMore: offset + limit < total };
  }

  /**
   * Get message count for a single session (cheap COUNT query).
   */
  getMessageCount(sessionId: string): number {
    const row = this.stmt(
      `SELECT COUNT(*) AS total FROM messages WHERE sessionId = ?`,
    ).get(sessionId) as { total: number };
    return row.total;
  }

  /**
   * Batch-fetch message counts for multiple sessions in a single query.
   * Returns a Map of sessionId -> count.
   */
  getMessageCountsBatch(sessionIds: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    if (sessionIds.length === 0) return counts;

    const placeholders = sessionIds.map(() => '?').join(',');
    const rows = this.db.prepare(`
      SELECT sessionId, COUNT(*) AS total FROM messages
      WHERE sessionId IN (${placeholders}) GROUP BY sessionId
    `).all(...sessionIds) as { sessionId: string; total: number }[];

    for (const row of rows) {
      counts.set(row.sessionId, row.total);
    }

    return counts;
  }

  getMessageParts(messageId: string): MessagePart[] {
    const rows = this.stmt(`
      SELECT id, messageId, "index", type, dataJson, createdAt
      FROM message_parts WHERE messageId = ? ORDER BY "index" ASC
    `).all(messageId) as { dataJson: string }[];

    return rows.map((row) => this.parseJson<MessagePart>(row.dataJson)!);
  }

  updateFinishReason(messageId: string, finishReason: string, usageJson?: string): void {
    this.stmt(`
      UPDATE messages SET finishReason = ?, usageJson = COALESCE(?, usageJson) WHERE id = ?
    `).run(finishReason, usageJson ?? null, messageId);
  }

  batchAddParts(parts: Array<{ messageId: string; sessionId?: string; part: MessagePart }>): void {
    this.transaction(() => {
      for (const { messageId, sessionId, part } of parts) {
        this.addPart({ ...part, messageId, sessionId });
      }
    });
  }

  deleteSessionMessages(sessionId: string): void {
    this.stmt(`DELETE FROM messages WHERE sessionId = ?`).run(sessionId);
  }
}
