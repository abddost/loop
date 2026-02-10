/**
 * Reasoning lifecycle reducers: reasoning-start, reasoning-delta, reasoning-done.
 */

import type {
  ReasoningStartEvent,
  ReasoningDeltaEvent,
  ReasoningDoneEvent,
  MessagePart,
} from '@coding-assistant/shared';
import type { SessionState } from '../event-store';
import { findMessage, findPartById, findLastPartByType } from './helpers';

export function applyReasoningStart(session: SessionState, event: ReasoningStartEvent): void {
  const msg = findMessage(session, event.messageId);
  if (!msg) return;
  msg.parts.push({
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
    const rPart = findPartById(msg, event.partId, 'reasoning');
    if (rPart) {
      rPart.text += event.delta;
    }
  } else {
    // Legacy fallback
    const lastReasoning = findLastPartByType(msg, 'reasoning');
    if (lastReasoning) {
      lastReasoning.text += event.delta;
    } else {
      msg.parts.push({
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
  const rPart = findPartById(msg, event.partId, 'reasoning');
  if (rPart) {
    rPart.text = event.text;
  }
}
