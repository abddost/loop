/**
 * Message and MessagePart persistence repository.
 */

import type { Message, MessagePart } from '@coding-assistant/shared';
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

interface JoinedRow extends MessageRow {
  partId: string | null;
  partIndex: number | null;
  partType: string | null;
  partDataJson: string | null;
}

export class MessageRepository extends BaseRepository {
  createMessage(message: Omit<Message, 'parts'>): void {
    this.db.prepare(`
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

  addPart(part: MessagePart & { messageId: string }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO message_parts (id, messageId, "index", type, dataJson, createdAt)
      VALUES ($id, $messageId, $index, $type, $dataJson, $createdAt)
    `).run({
      $id: part.id,
      $messageId: part.messageId,
      $index: part.index,
      $type: part.type,
      $dataJson: this.toJson(part),
      $createdAt: new Date().toISOString(),
    });
  }

  /**
   * Load all messages for a session with their parts in a single query.
   *
   * Uses a LEFT JOIN instead of N+1 separate queries (one per message).
   * Parts are grouped by message ID in-memory.
   */
  getSessionMessages(sessionId: string): Message[] {
    const rows = this.db.prepare(`
      SELECT
        m.id, m.sessionId, m.role, m."index", m.modelId, m.finishReason,
        m.usageJson, m.errorJson, m.createdAt,
        mp.id AS partId, mp."index" AS partIndex, mp.type AS partType, mp.dataJson AS partDataJson
      FROM messages m
      LEFT JOIN message_parts mp ON m.id = mp.messageId
      WHERE m.sessionId = ?
      ORDER BY m."index" ASC, mp."index" ASC
    `).all(sessionId) as JoinedRow[];

    // Group parts by message using insertion-order Map
    const messagesMap = new Map<string, Message>();

    for (const row of rows) {
      if (!messagesMap.has(row.id)) {
        messagesMap.set(row.id, {
          id: row.id,
          sessionId: row.sessionId,
          role: row.role as Message['role'],
          index: row.index,
          modelId: row.modelId,
          finishReason: row.finishReason as Message['finishReason'],
          usage: this.parseJson(row.usageJson),
          error: this.parseJson(row.errorJson),
          parts: [],
          createdAt: row.createdAt,
        });
      }

      // Add part if the LEFT JOIN produced a match
      if (row.partId && row.partDataJson) {
        const message = messagesMap.get(row.id)!;
        const part = this.parseJson<MessagePart>(row.partDataJson);
        if (part) message.parts.push(part);
      }
    }

    return Array.from(messagesMap.values());
  }

  getMessageParts(messageId: string): MessagePart[] {
    const rows = this.db.prepare(`
      SELECT id, messageId, "index", type, dataJson, createdAt
      FROM message_parts WHERE messageId = ? ORDER BY "index" ASC
    `).all(messageId) as { dataJson: string }[];

    return rows.map((row) => this.parseJson<MessagePart>(row.dataJson)!);
  }

  updateFinishReason(messageId: string, finishReason: string, usageJson?: string): void {
    this.db.prepare(`
      UPDATE messages SET finishReason = ?, usageJson = COALESCE(?, usageJson) WHERE id = ?
    `).run(finishReason, usageJson ?? null, messageId);
  }

  deleteSessionMessages(sessionId: string): void {
    this.db.prepare(`DELETE FROM messages WHERE sessionId = ?`).run(sessionId);
  }
}
