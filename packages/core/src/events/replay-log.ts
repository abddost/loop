/**
 * Replay log -- bridges the GlobalEventBus with persistence.
 * Used for SSE reconnect replay.
 */

import type { StreamEvent } from '@coding-assistant/shared';
// Use a structural type to avoid hard dependency on packages/persistence
interface EventLogRepo {
  getLatestSeq(): number;
  append(event: import('@coding-assistant/shared').StreamEvent): number;
  getAfter(globalSeq: number): import('@coding-assistant/shared').StreamEvent[];
  prune(beforeSeq: number): number;
}
import { globalEventBus } from './bus.js';

export class ReplayLog {
  private repo: EventLogRepo;

  constructor(repo: EventLogRepo) {
    this.repo = repo;
  }

  /**
   * Initialize: set the event bus sequence from the last persisted event.
   */
  initialize(): void {
    const latestSeq = this.repo.getLatestSeq();
    globalEventBus.setSeq(latestSeq);
  }

  /**
   * Persist an event and return the assigned globalSeq.
   */
  append(event: StreamEvent): number {
    return this.repo.append(event);
  }

  /**
   * Get events after a certain sequence number (for SSE reconnect).
   */
  getAfter(globalSeq: number): StreamEvent[] {
    return this.repo.getAfter(globalSeq);
  }

  /**
   * Prune old events.
   */
  prune(beforeSeq: number): number {
    return this.repo.prune(beforeSeq);
  }
}
