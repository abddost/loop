/**
 * Reasoning lifecycle reducers: reasoning-start, reasoning-delta, reasoning-done.
 *
 * All updates are immutable: new part/message/array references are
 * created for modified items so React.memo can detect changes.
 */

import type {
  ReasoningStartEvent,
  ReasoningDeltaEvent,
  ReasoningDoneEvent,
  MessagePart,
} from '@coding-assistant/shared';
import type { SessionState } from '../event-store';
import {
  findMessage,
  findLastPartByType,
  immutablePushPart,
  immutableSetPart,
} from './helpers';

export function applyReasoningStart(session: SessionState, event: ReasoningStartEvent): void {
  const msg = findMessage(session, event.messageId);
  if (!msg) return;
  immutablePushPart(session, msg, {
    type: 'reasoning',
    id: event.partId,
    index: msg.parts.length,
    text: '',
  } as MessagePart);
}

export function applyReasoningDelta(session: SessionState, event: ReasoningDeltaEvent): void {
  const msg = findMessage(session, event.messageId);
  if (!msg) return;

  if (event.partId) {
    const partIdx = msg.parts.findIndex((p) => p.type === 'reasoning' && p.id === event.partId);
    if (partIdx === -1) return;
    const part = msg.parts[partIdx] as MessagePart & { text: string };
    immutableSetPart(session, msg, partIdx, {
      ...part,
      text: part.text + event.delta,
    } as MessagePart);
  } else {
    // Legacy fallback
    const lastReasoning = findLastPartByType(msg, 'reasoning');
    if (lastReasoning) {
      const partIdx = msg.parts.lastIndexOf(lastReasoning as MessagePart);
      immutableSetPart(session, msg, partIdx, {
        ...lastReasoning,
        text: lastReasoning.text + event.delta,
      } as MessagePart);
    } else {
      immutablePushPart(session, msg, {
        type: 'reasoning',
        id: `part_${Date.now()}_r`,
        index: msg.parts.length,
        text: event.delta,
      } as MessagePart);
    }
  }
}

export function applyReasoningDone(session: SessionState, event: ReasoningDoneEvent): void {
  const msg = findMessage(session, event.messageId);
  if (!msg) return;

  const partIdx = msg.parts.findIndex((p) => p.type === 'reasoning' && p.id === event.partId);
  if (partIdx === -1) return;
  const part = msg.parts[partIdx] as MessagePart & { text: string };
  immutableSetPart(session, msg, partIdx, {
    ...part,
    text: event.text,
  } as MessagePart);
}
