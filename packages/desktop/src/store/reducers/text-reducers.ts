/**
 * Text lifecycle reducers: text-start, text-delta, text-done.
 *
 * All updates are immutable: new part/message/array references are
 * created for modified items so React.memo can detect changes.
 */

import type {
  TextStartEvent,
  TextDeltaEvent,
  TextDoneEvent,
  MessagePart,
} from '@coding-assistant/shared';
import type { SessionState } from '../event-store';
import {
  findMessage,
  findLastPartByType,
  immutablePushPart,
  immutableSetPart,
} from './helpers';

export function applyTextStart(session: SessionState, event: TextStartEvent): void {
  const msg = findMessage(session, event.messageId);
  if (!msg) return;
  immutablePushPart(session, msg, {
    type: 'text',
    id: event.partId,
    index: msg.parts.length,
    text: '',
  } as MessagePart);
}

export function applyTextDelta(session: SessionState, event: TextDeltaEvent): void {
  const msg = findMessage(session, event.messageId);
  if (!msg) return;

  if (event.partId) {
    const partIdx = msg.parts.findIndex((p) => p.type === 'text' && p.id === event.partId);
    if (partIdx === -1) return;
    const part = msg.parts[partIdx] as MessagePart & { text: string };
    immutableSetPart(session, msg, partIdx, {
      ...part,
      text: part.text + event.delta,
    } as MessagePart);
  } else {
    // Legacy: no partId, find or create the last text part
    const lastText = findLastPartByType(msg, 'text');
    if (lastText) {
      const partIdx = msg.parts.lastIndexOf(lastText as MessagePart);
      immutableSetPart(session, msg, partIdx, {
        ...lastText,
        text: lastText.text + event.delta,
      } as MessagePart);
    } else {
      immutablePushPart(session, msg, {
        type: 'text',
        id: `part_${Date.now()}`,
        index: msg.parts.length,
        text: event.delta,
      } as MessagePart);
    }
  }
}

export function applyTextDone(session: SessionState, event: TextDoneEvent): void {
  const msg = findMessage(session, event.messageId);
  if (!msg) return;

  if (event.partId) {
    const partIdx = msg.parts.findIndex((p) => p.type === 'text' && p.id === event.partId);
    if (partIdx === -1) return;
    const part = msg.parts[partIdx] as MessagePart & { text: string };
    immutableSetPart(session, msg, partIdx, {
      ...part,
      text: event.text,
    } as MessagePart);
  } else {
    // Legacy: replace or create the last text part
    const lastText = findLastPartByType(msg, 'text');
    if (lastText) {
      const partIdx = msg.parts.lastIndexOf(lastText as MessagePart);
      immutableSetPart(session, msg, partIdx, {
        ...lastText,
        text: event.text,
      } as MessagePart);
    } else {
      immutablePushPart(session, msg, {
        type: 'text',
        id: `part_${Date.now()}`,
        index: msg.parts.length,
        text: event.text,
      } as MessagePart);
    }
  }
}
