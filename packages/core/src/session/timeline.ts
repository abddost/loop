/**
 * MessageTimeline -- ordered message + part append.
 * The canonical in-memory representation of a session's conversation.
 *
 * Supports both deferred timeline updates (after stream completes)
 * and incremental updates during streaming for crash recovery.
 */

import type { Message, MessagePart, UIMessage, ToolStatus } from '@coding-assistant/shared';
import { generateMessageId, normalizeMessages } from '@coding-assistant/shared';

/** Listener called whenever the timeline is mutated */
export type TimelineListener = (event: TimelineMutationEvent) => void;

export type TimelineMutationEvent =
  | { type: 'message-appended'; message: Message }
  | { type: 'part-appended'; messageId: string; part: MessagePart }
  | { type: 'part-updated'; messageId: string; partId: string; part: MessagePart; changes: Partial<MessagePart> }
  | { type: 'messages-loaded'; count: number }
  | { type: 'messages-replaced'; count: number }
  | { type: 'cleared' };

export class MessageTimeline {
  private _messages: Message[] = [];
  private listeners = new Set<TimelineListener>();
  /** Set once during construction via setSessionId(). */
  private _sessionId: string = '';

  /** Lazy loader for deferred message loading (set during session restoration). */
  private _lazyLoader: (() => Message[]) | null = null;
  /** Whether messages have been loaded (true by default for new timelines). */
  private _loaded: boolean = true;

  /** O(1) message lookup by ID — kept in sync with _messages on every mutation. */
  private _messageIndex = new Map<string, Message>();

  /** Monotonic version counter — incremented on every notify(). */
  private _version: number = 0;
  /** Cached toUIMessages() result, invalidated when _version changes. */
  private _uiMessagesCache: UIMessage[] | null = null;
  private _uiMessagesCacheVersion: number = -1;

  get sessionId(): string {
    return this._sessionId;
  }

  /**
   * Initialize the session ID. Should be called once from SessionContext constructor.
   * Throws if called more than once with a different value.
   */
  setSessionId(id: string): void {
    if (this._sessionId && this._sessionId !== id) {
      throw new Error(`Cannot change sessionId from "${this._sessionId}" to "${id}"`);
    }
    this._sessionId = id;
  }

  /**
   * Set a lazy loader for deferred message loading.
   * Messages will only be loaded when first accessed.
   */
  setLazyLoader(loader: () => Message[]): void {
    this._lazyLoader = loader;
    this._loaded = false;
  }

  /**
   * Ensure messages are loaded before accessing them.
   * If a lazy loader is set, triggers the load and releases the loader reference.
   */
  private ensureLoaded(): void {
    if (this._loaded) return;
    const messages = this._lazyLoader!();
    this._messages = messages;
    this._loaded = true;
    this._lazyLoader = null;
    this.rebuildIndex();
  }

  /** Rebuild the _messageIndex from scratch. */
  private rebuildIndex(): void {
    this._messageIndex.clear();
    for (const msg of this._messages) {
      this._messageIndex.set(msg.id, msg);
    }
  }

  get messages(): readonly Message[] {
    this.ensureLoaded();
    return this._messages;
  }

  get length(): number {
    this.ensureLoaded();
    return this._messages.length;
  }

  /**
   * Subscribe to timeline mutations for incremental persistence.
   * Returns an unsubscribe function.
   */
  onMutation(listener: TimelineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(event: TimelineMutationEvent): void {
    this._version++;
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors affect the timeline
      }
    }
  }

  /**
   * Append a new message to the timeline.
   * If `id` is provided (e.g. from a client optimistic insert), use it
   * instead of generating a new one -- this ensures SSE events reference
   * the same messageId so the frontend can reconcile without duplicates.
   */
  appendMessage(params: {
    id?: string;
    role: Message['role'];
    modelId?: string;
    parts?: MessagePart[];
    hidden?: boolean;
  }): Message {
    this.ensureLoaded();
    const message: Message = {
      id: params.id ?? generateMessageId(),
      sessionId: this.sessionId,
      role: params.role,
      index: this._messages.length,
      modelId: params.modelId ?? null,
      finishReason: null,
      usage: null,
      error: null,
      parts: params.parts ?? [],
      createdAt: new Date().toISOString(),
      ...(params.hidden ? { hidden: true } : {}),
    };
    this._messages.push(message);
    this._messageIndex.set(message.id, message);
    this.notify({ type: 'message-appended', message });
    return message;
  }

  /**
   * Append a part to the last message.
   */
  appendPart(part: MessagePart): void {
    this.ensureLoaded();
    const last = this._messages[this._messages.length - 1];
    if (!last) throw new Error('No message to append part to');
    last.parts.push(part);
    this.notify({ type: 'part-appended', messageId: last.id, part });
  }

  /**
   * Append a part to a specific message by ID.
   */
  appendPartToMessage(messageId: string, part: MessagePart): void {
    this.ensureLoaded();
    const msg = this._messageIndex.get(messageId);
    if (!msg) throw new Error(`Message ${messageId} not found`);
    part.index = msg.parts.length;
    msg.parts.push(part);
    this.notify({ type: 'part-appended', messageId, part });
  }

  /**
   * Update a specific part within a message.
   * Used for incremental updates (e.g., accumulating text deltas).
   */
  updatePart(messageId: string, partId: string, changes: Partial<MessagePart>): void {
    this.ensureLoaded();
    const msg = this._messageIndex.get(messageId);
    if (!msg) return;
    const part = msg.parts.find((p) => p.id === partId);
    if (!part) return;
    Object.assign(part, changes);
    this.notify({ type: 'part-updated', messageId, partId, part, changes });
  }

  /**
   * Find a part by ID within a specific message.
   */
  findPart(messageId: string, partId: string): MessagePart | undefined {
    this.ensureLoaded();
    const msg = this._messageIndex.get(messageId);
    return msg?.parts.find((p) => p.id === partId);
  }

  /**
   * Get the last message.
   */
  last(): Message | undefined {
    this.ensureLoaded();
    return this._messages[this._messages.length - 1];
  }

  /**
   * Convert to UI messages for rendering.
   * Uses a version-based cache — only rebuilt when timeline is mutated.
   */
  toUIMessages(): UIMessage[] {
    this.ensureLoaded();
    if (this._uiMessagesCache && this._uiMessagesCacheVersion === this._version) {
      return this._uiMessagesCache;
    }
    const raw = this._messages
      .filter((m) => !m.hidden)
      .map((m) => ({
        id: m.id,
        role: m.role,
        parts: [...m.parts],
        modelId: m.modelId,
        createdAt: m.createdAt,
      }));
    // Normalize: merge stray tool-result parts from role:'tool' messages
    // into the preceding assistant message (backward compat for old data).
    this._uiMessagesCache = normalizeMessages(raw);
    this._uiMessagesCacheVersion = this._version;
    return this._uiMessagesCache;
  }

  /**
   * Paginated version of toUIMessages() — slices the cached array.
   */
  toUIMessagesPaginated(offset: number, limit: number): { messages: UIMessage[]; total: number } {
    const all = this.toUIMessages();
    return {
      messages: all.slice(offset, offset + limit),
      total: all.length,
    };
  }

  /**
   * Load from persisted messages.
   */
  loadFromPersisted(messages: Message[]): void {
    this._loaded = true;
    this._lazyLoader = null;
    this._messages = [...messages];
    this.rebuildIndex();
    this.notify({ type: 'messages-loaded', count: messages.length });
  }

  /**
   * Clear all messages (for compaction).
   */
  clear(): void {
    this._loaded = true;
    this._lazyLoader = null;
    this._messages = [];
    this._messageIndex.clear();
    this.notify({ type: 'cleared' });
  }

  /**
   * Replace all messages atomically (for compaction).
   * Unlike clear() + loadFromPersisted(), this emits a single event.
   */
  replaceMessages(messages: Message[]): void {
    this._loaded = true;
    this._lazyLoader = null;
    this._messages = [...messages];
    this.rebuildIndex();
    this.notify({ type: 'messages-replaced', count: messages.length });
  }

  /**
   * Get messages after a certain index (for incremental sends).
   */
  after(index: number): Message[] {
    this.ensureLoaded();
    return this._messages.slice(index + 1);
  }

  /**
   * Count all tool-call parts matching the given criteria in the last N parts
   * of a specific message. Used for doom loop detection.
   */
  countRecentIdenticalToolCalls(
    messageId: string,
    toolName: string,
    argsJson: string,
    threshold: number,
  ): number {
    this.ensureLoaded();
    const msg = this._messageIndex.get(messageId);
    if (!msg) return 0;

    const toolParts = msg.parts.filter(
      (p) => p.type === 'tool-call' && p.toolName === toolName,
    );

    const lastN = toolParts.slice(-threshold);
    let count = 0;
    for (const part of lastN) {
      if (part.type === 'tool-call' && JSON.stringify(part.args) === argsJson) {
        count++;
      }
    }
    return count;
  }
}
