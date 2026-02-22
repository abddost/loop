/**
 * TimelinePersistenceListener -- bridges timeline mutations to message persistence.
 *
 * Subscribes to a MessageTimeline's onMutation() events and writes them
 * to the MessageRepository. Handles debouncing of part updates to avoid
 * excessive DB writes during streaming.
 */

import type { Message, MessagePart } from '@coding-assistant/shared';
import type { TimelineMutationEvent } from './timeline.js';
import { TIMELINE_FLUSH_INTERVAL_MS } from '../constants.js';

/** Interface matching MessageRepository from packages/server/persistence */
interface MessageRepo {
  createMessage(message: Omit<Message, 'parts'>): void;
  addPart(part: MessagePart & { messageId: string; sessionId?: string }): void;
  batchAddParts(parts: Array<{ messageId: string; sessionId?: string; part: MessagePart }>): void;
  getSessionMessages(sessionId: string): Message[];
}

export class TimelinePersistenceListener {
  private sessionId: string;
  private messageRepo: MessageRepo;

  /** Pending part updates, keyed by partId. Flushed periodically. */
  private pendingPartUpdates = new Map<string, { messageId: string; sessionId: string; part: MessagePart }>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /** Debounce interval for part-updated events (ms) */
  private static readonly FLUSH_INTERVAL_MS = TIMELINE_FLUSH_INTERVAL_MS;

  constructor(sessionId: string, messageRepo: MessageRepo) {
    this.sessionId = sessionId;
    this.messageRepo = messageRepo;
  }

  /**
   * Handle a timeline mutation event. Bound method for use as a callback.
   */
  handleMutation = (event: TimelineMutationEvent): void => {
    try {
      switch (event.type) {
        case 'message-appended':
          this.onMessageAppended(event.message);
          break;
        case 'part-appended':
          // Flush any pending updates before appending a new part
          this.flush();
          this.onPartAppended(event.messageId, event.part);
          break;
        case 'part-updated':
          this.onPartUpdated(event.messageId, event.part);
          break;
        case 'messages-loaded':
        case 'cleared':
          // No-op: these are bulk operations triggered by restore/compaction
          break;
      }
    } catch (err) {
      console.error('[timeline-persistence] Failed to persist mutation:', err);
    }
  };

  /**
   * Persist a newly appended message and all its initial parts.
   */
  private onMessageAppended(message: Message): void {
    // Hidden messages exist only in the in-memory timeline (the build agent
    // reads them there). Don't persist them so they can't leak on reload.
    if (message.hidden) return;

    // Ensure sessionId is set
    const msg = message.sessionId ? message : { ...message, sessionId: this.sessionId };

    this.messageRepo.createMessage(msg);

    // Persist any initial parts in a single transaction (e.g., user messages come with text parts)
    if (message.parts.length > 0) {
      this.messageRepo.batchAddParts(
        message.parts.map(part => ({
          messageId: msg.id,
          sessionId: this.sessionId,
          part,
        })),
      );
    }
  }

  /**
   * Persist a newly appended part.
   */
  private onPartAppended(messageId: string, part: MessagePart): void {
    this.messageRepo.addPart({ ...part, messageId, sessionId: this.sessionId });
  }

  /**
   * Queue a part update for debounced persistence.
   * During streaming, text parts get updated many times per second
   * with text deltas. We batch these updates and flush periodically.
   */
  private onPartUpdated(messageId: string, part: MessagePart): void {
    this.pendingPartUpdates.set(part.id, { messageId, sessionId: this.sessionId, part });
    this.scheduleFlush();
  }

  /**
   * Schedule a flush of pending part updates.
   */
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, TimelinePersistenceListener.FLUSH_INTERVAL_MS);
  }

  /**
   * Dispose the listener -- flushes pending updates and clears the timer.
   * Call this when the session is being closed.
   */
  dispose(): void {
    this.flush();
  }

  /**
   * Flush all pending part updates to the database in a single batch transaction.
   * Uses INSERT OR REPLACE so the latest version wins.
   */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.pendingPartUpdates.size === 0) return;

    const batch = Array.from(this.pendingPartUpdates.values());
    this.pendingPartUpdates.clear();

    try {
      this.messageRepo.batchAddParts(batch);
    } catch (err) {
      console.error('[timeline-persistence] Failed to flush part updates:', err);
    }
  }
}
