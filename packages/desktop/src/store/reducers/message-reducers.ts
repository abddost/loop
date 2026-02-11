/**
 * Message lifecycle reducers: message-start, message-done, step-start, step-finish.
 */

import type {
  MessageStartEvent,
  MessageDoneEvent,
  StepStartEvent,
  StepFinishEvent,
  MessagePart,
} from '@coding-assistant/shared';
import type { SessionState, MessageMetadata } from '../event-store';
import { findMessage, pushMessage, lastAssistantMessage } from './helpers';

export function applyMessageStart(session: SessionState, event: MessageStartEvent): void {
  // Skip if message already exists (optimistic update inserted it earlier)
  if (findMessage(session, event.messageId)) return;
  pushMessage(session, {
    id: event.messageId,
    role: event.role,
    parts: [],
    modelId: null,
    createdAt: event.timestamp,
  });
}

export function applyMessageDone(session: SessionState, event: MessageDoneEvent): void {
  const msg = findMessage(session, event.messageId);
  if (!msg) return;
  if (event.modelId) msg.modelId = event.modelId;

  // Store metadata using the proper typed map
  session.messageMetadata.set(msg.id, {
    finishReason: event.finishReason,
    usage: event.usage,
    totalCost: event.totalCost,
  });
}

export function applyStepStart(session: SessionState, event: StepStartEvent): void {
  const msg = findMessage(session, event.messageId) ?? lastAssistantMessage(session);
  if (msg) {
    msg.parts.push({
      type: 'step-start',
      id: `part_${Date.now()}_ss`,
      index: msg.parts.length,
      stepNumber: event.stepNumber,
    } as MessagePart);
  }
}

export function applyStepFinish(session: SessionState, event: StepFinishEvent): void {
  const msg = findMessage(session, event.messageId) ?? lastAssistantMessage(session);
  if (msg) {
    msg.parts.push({
      type: 'step-finish',
      id: `part_${Date.now()}_sf`,
      index: msg.parts.length,
      stepNumber: event.stepNumber,
      finishReason: event.finishReason,
      usage: event.usage,
      cost: event.cost,
    } as MessagePart);
  }
}
