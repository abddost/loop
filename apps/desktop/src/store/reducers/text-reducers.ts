/**
 * Text lifecycle reducers: text-start, text-delta, text-done.
 */

import type {
  TextStartEvent,
  TextDeltaEvent,
  TextDoneEvent,
} from '@coding-assistant/shared';
import type { SessionState } from '../event-store';
import { findMessage, findPartById, findLastPartByType } from './helpers';

export function applyTextStart(session: SessionState, event: TextStartEvent): void {
  const msg = findMessage(session, event.messageId);
  if (!msg) return;
  msg.parts.push({
    type: 'text',
    id: event.partId,
    index: msg.parts.length,
    text: '',
  });
}

export function applyTextDelta(session: SessionState, event: TextDeltaEvent): void {
  const msg = findMessage(session, event.messageId);
  if (!msg) return;

  if (event.partId) {
    const textPart = findPartById(msg, event.partId, 'text');
    if (textPart) {
      textPart.text += event.delta;
    }
  } else {
    // Legacy: no partId, find or create the last text part
    const lastText = findLastPartByType(msg, 'text');
    if (lastText) {
      lastText.text += event.delta;
    } else {
      msg.parts.push({
        type: 'text',
        id: `part_${Date.now()}`,
        index: msg.parts.length,
        text: event.delta,
      });
    }
  }
}

export function applyTextDone(session: SessionState, event: TextDoneEvent): void {
  const msg = findMessage(session, event.messageId);
  if (!msg) return;

  if (event.partId) {
    const textPart = findPartById(msg, event.partId, 'text');
    if (textPart) {
      textPart.text = event.text;
    }
  } else {
    // Legacy: replace or create the last text part
    const lastText = findLastPartByType(msg, 'text');
    if (lastText) {
      lastText.text = event.text;
    } else {
      msg.parts.push({
        type: 'text',
        id: `part_${Date.now()}`,
        index: msg.parts.length,
        text: event.text,
      });
    }
  }
}
