/**
 * Compaction reducers: compaction-start and compaction-done events.
 *
 * Follows the same immutable pattern as file-patch-reducer.
 */

import type { CompactionStartEvent, CompactionDoneEvent, MessagePart } from '@coding-assistant/shared';
import type { SessionState } from '../event-store';
import { findMessage, lastAssistantMessage, immutablePushPart, immutableSetPart } from './helpers';

export function applyCompactionStart(session: SessionState, event: CompactionStartEvent): void {
  const msg = findMessage(session, event.messageId) ?? lastAssistantMessage(session);
  if (!msg) return;

  immutablePushPart(session, msg, {
    type: 'compaction',
    id: `part_${Date.now()}_cs`,
    index: msg.parts.length,
    status: 'compacting',
    messagesCompacted: event.messagesToCompact,
  } as MessagePart);
}

export function applyCompactionDone(session: SessionState, event: CompactionDoneEvent): void {
  const msg = findMessage(session, event.messageId) ?? lastAssistantMessage(session);
  if (!msg) return;

  // Find the compacting part and replace it with done status + metrics
  const partIdx = msg.parts.findIndex(
    (p) => p.type === 'compaction' && (p as { status: string }).status === 'compacting',
  );

  if (partIdx !== -1) {
    immutableSetPart(session, msg, partIdx, {
      ...msg.parts[partIdx],
      status: 'done',
      messagesCompacted: event.messagesCompacted,
      tokensFreed: event.tokensFreed,
    } as MessagePart);
  } else {
    // No matching start found -- push as done
    immutablePushPart(session, msg, {
      type: 'compaction',
      id: `part_${Date.now()}_cd`,
      index: msg.parts.length,
      status: 'done',
      messagesCompacted: event.messagesCompacted,
      tokensFreed: event.tokensFreed,
    } as MessagePart);
  }
}
