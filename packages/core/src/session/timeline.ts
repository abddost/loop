/**
 * MessageTimeline -- ordered message + part append.
 * The canonical in-memory representation of a session's conversation.
 */

import type { Message, MessagePart, UIMessage } from '@coding-assistant/shared';
import { generateMessageId } from '@coding-assistant/shared';

export class MessageTimeline {
  private _messages: Message[] = [];

  get messages(): readonly Message[] {
    return this._messages;
  }

  get length(): number {
    return this._messages.length;
  }

  /**
   * Append a new message to the timeline.
   */
  appendMessage(params: {
    role: Message['role'];
    modelId?: string;
    parts?: MessagePart[];
  }): Message {
    const message: Message = {
      id: generateMessageId(),
      sessionId: '', // set by caller
      role: params.role,
      index: this._messages.length,
      modelId: params.modelId ?? null,
      finishReason: null,
      usage: null,
      error: null,
      parts: params.parts ?? [],
      createdAt: new Date().toISOString(),
    };
    this._messages.push(message);
    return message;
  }

  /**
   * Append a part to the last message.
   */
  appendPart(part: MessagePart): void {
    const last = this._messages[this._messages.length - 1];
    if (!last) throw new Error('No message to append part to');
    last.parts.push(part);
  }

  /**
   * Get the last message.
   */
  last(): Message | undefined {
    return this._messages[this._messages.length - 1];
  }

  /**
   * Convert to UI messages for rendering.
   */
  toUIMessages(): UIMessage[] {
    return this._messages.map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts,
      modelId: m.modelId,
      createdAt: m.createdAt,
    }));
  }

  /**
   * Load from persisted messages.
   */
  loadFromPersisted(messages: Message[]): void {
    this._messages = [...messages];
  }

  /**
   * Clear all messages (for compaction).
   */
  clear(): void {
    this._messages = [];
  }

  /**
   * Get messages after a certain index (for incremental sends).
   */
  after(index: number): Message[] {
    return this._messages.slice(index + 1);
  }
}
