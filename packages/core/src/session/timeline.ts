/**
 * MessageTimeline -- ordered message + part append.
 * The canonical in-memory representation of a session's conversation.
 *
 * Supports both deferred timeline updates (after stream completes)
 * and incremental updates during streaming for crash recovery.
 *
 * Idle eviction: After EVICTION_MS of inactivity, loaded messages
 * are released from memory and the lazy loader is re-armed.
 * The next access transparently reloads from the database.
 */

import type { Message, MessagePart, UIMessage } from '@coding-assistant/shared';
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
  private _sessionId: string = '';

  private _lazyLoader: (() => Message[]) | null = null;
  private _loaded: boolean = true;

  /**
   * Original loader factory -- kept across evictions so we can re-arm.
   * Set via setLazyLoader(); never cleared.
   */
  private _loaderFactory: (() => Message[]) | null = null;

  private _messageIndex = new Map<string, Message>();

  private _version: number = 0;
  private _uiMessagesCache: UIMessage[] | null = null;
  private _uiMessagesCacheVersion: number = -1;

  /** Idle eviction: release messages after 5 minutes of inactivity. */
  private static readonly EVICTION_MS = 5 * 60 * 1000;
  private _idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** When true, eviction is suppressed (e.g. during active streaming). */
  private _pinned: boolean = false;

  get sessionId(): string {
    return this._sessionId;
  }

  setSessionId(id: string): void {
    if (this._sessionId && this._sessionId !== id) {
      throw new Error(`Cannot change sessionId from "${this._sessionId}" to "${id}"`);
    }
    this._sessionId = id;
  }

  /**
   * Set a lazy loader for deferred message loading.
   * Also stores the loader as the eviction re-arm target.
   */
  setLazyLoader(loader: () => Message[]): void {
    this._lazyLoader = loader;
    this._loaderFactory = loader;
    this._loaded = false;
  }

  private ensureLoaded(): void {
    if (this._loaded) return;
    const messages = this._lazyLoader!();
    this._messages = messages;
    this._loaded = true;
    this._lazyLoader = null;
    this.rebuildIndex();
    this.resetIdleTimer();
  }

  private rebuildIndex(): void {
    this._messageIndex.clear();
    for (const msg of this._messages) {
      this._messageIndex.set(msg.id, msg);
    }
  }

  // ── Idle eviction ──────────────────────────────────────────────────

  /**
   * Pin the timeline in memory (prevents eviction during active streaming).
   */
  pin(): void {
    this._pinned = true;
    this.clearIdleTimer();
  }

  /**
   * Unpin the timeline and start the eviction timer.
   */
  unpin(): void {
    this._pinned = false;
    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    if (this._pinned || !this._loaderFactory) return;
    this._idleTimer = setTimeout(() => this.evict(), MessageTimeline.EVICTION_MS);
  }

  private clearIdleTimer(): void {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }

  /**
   * Evict loaded messages from memory.
   * Re-arms the lazy loader so the next access reloads from DB.
   */
  private evict(): void {
    if (this._pinned) return;
    if (!this._loaderFactory) return;
    if (!this._loaded) return;

    this._messages = [];
    this._messageIndex.clear();
    this._uiMessagesCache = null;
    this._uiMessagesCacheVersion = -1;
    this._lazyLoader = this._loaderFactory;
    this._loaded = false;
    this._idleTimer = null;
  }

  // ── Public API ─────────────────────────────────────────────────────

  get messages(): readonly Message[] {
    this.ensureLoaded();
    this.resetIdleTimer();
    return this._messages;
  }

  get length(): number {
    this.ensureLoaded();
    return this._messages.length;
  }

  onMutation(listener: TimelineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(event: TimelineMutationEvent): void {
    this._version++;
    this.resetIdleTimer();
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't let listener errors affect the timeline
      }
    }
  }

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

  appendPart(part: MessagePart): void {
    this.ensureLoaded();
    const last = this._messages[this._messages.length - 1];
    if (!last) throw new Error('No message to append part to');
    last.parts.push(part);
    this.notify({ type: 'part-appended', messageId: last.id, part });
  }

  appendPartToMessage(messageId: string, part: MessagePart): void {
    this.ensureLoaded();
    const msg = this._messageIndex.get(messageId);
    if (!msg) throw new Error(`Message ${messageId} not found`);
    part.index = msg.parts.length;
    msg.parts.push(part);
    this.notify({ type: 'part-appended', messageId, part });
  }

  updatePart(messageId: string, partId: string, changes: Partial<MessagePart>): void {
    this.ensureLoaded();
    const msg = this._messageIndex.get(messageId);
    if (!msg) return;
    const part = msg.parts.find((p) => p.id === partId);
    if (!part) return;
    Object.assign(part, changes);
    this.notify({ type: 'part-updated', messageId, partId, part, changes });
  }

  findPart(messageId: string, partId: string): MessagePart | undefined {
    this.ensureLoaded();
    const msg = this._messageIndex.get(messageId);
    return msg?.parts.find((p) => p.id === partId);
  }

  last(): Message | undefined {
    this.ensureLoaded();
    return this._messages[this._messages.length - 1];
  }

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
    this._uiMessagesCache = normalizeMessages(raw);
    this._uiMessagesCacheVersion = this._version;
    return this._uiMessagesCache;
  }

  toUIMessagesPaginated(offset: number, limit: number): { messages: UIMessage[]; total: number } {
    const all = this.toUIMessages();
    return {
      messages: all.slice(offset, offset + limit),
      total: all.length,
    };
  }

  loadFromPersisted(messages: Message[]): void {
    this._loaded = true;
    this._lazyLoader = null;
    this._messages = [...messages];
    this.rebuildIndex();
    this.notify({ type: 'messages-loaded', count: messages.length });
  }

  clear(): void {
    this._loaded = true;
    this._lazyLoader = null;
    this._messages = [];
    this._messageIndex.clear();
    this.notify({ type: 'cleared' });
  }

  replaceMessages(messages: Message[]): void {
    this._loaded = true;
    this._lazyLoader = null;
    this._messages = [...messages];
    this.rebuildIndex();
    this.notify({ type: 'messages-replaced', count: messages.length });
  }

  after(index: number): Message[] {
    this.ensureLoaded();
    return this._messages.slice(index + 1);
  }

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

  /**
   * Dispose the timeline -- clears the idle timer.
   */
  dispose(): void {
    this.clearIdleTimer();
  }
}
