/**
 * Message and MessagePart persistence repository.
 */

import type Database from 'better-sqlite3';
import type { Message, MessagePart } from '@coding-assistant/shared';

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
  index: number;
  type: string;
  dataJson: string;
  createdAt: string;
}

export class MessageRepository {
  constructor(private db: Database.Database) {}

  createMessage(message: Omit<Message, 'parts'>): void {
    this.db.prepare(`
      INSERT INTO messages (id, sessionId, role, "index", modelId, finishReason, usageJson, errorJson, createdAt)
      VALUES (@id, @sessionId, @role, @index, @modelId, @finishReason, @usageJson, @errorJson, @createdAt)
    `).run({
      id: message.id,
      sessionId: message.sessionId,
      role: message.role,
      index: message.index,
      modelId: message.modelId,
      finishReason: message.finishReason,
      usageJson: message.usage ? JSON.stringify(message.usage) : null,
      errorJson: message.error ? JSON.stringify(message.error) : null,
      createdAt: message.createdAt,
    });
  }

  addPart(part: MessagePart & { messageId: string }): void {
    this.db.prepare(`
      INSERT INTO message_parts (id, messageId, "index", type, dataJson, createdAt)
      VALUES (@id, @messageId, @index, @type, @dataJson, @createdAt)
    `).run({
      id: part.id,
      messageId: part.messageId,
      index: part.index,
      type: part.type,
      dataJson: JSON.stringify(part),
      createdAt: new Date().toISOString(),
    });
  }

  getSessionMessages(sessionId: string): Message[] {
    const rows = this.db.prepare(`
      SELECT id, sessionId, role, "index", modelId, finishReason, usageJson, errorJson, createdAt
      FROM messages WHERE sessionId = ? ORDER BY "index" ASC
    `).all(sessionId) as MessageRow[];

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      role: row.role as Message['role'],
      index: row.index,
      modelId: row.modelId,
      finishReason: row.finishReason as Message['finishReason'],
      usage: row.usageJson ? JSON.parse(row.usageJson) : null,
      error: row.errorJson ? JSON.parse(row.errorJson) : null,
      parts: this.getMessageParts(row.id),
      createdAt: row.createdAt,
    }));
  }

  getMessageParts(messageId: string): MessagePart[] {
    const rows = this.db.prepare(`
      SELECT id, messageId, "index", type, dataJson, createdAt
      FROM message_parts WHERE messageId = ? ORDER BY "index" ASC
    `).all(messageId) as PartRow[];

    return rows.map((row) => JSON.parse(row.dataJson) as MessagePart);
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
