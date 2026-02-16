/**
 * Message lifecycle reducers: message-start, message-done, step-start, step-finish.
 *
 * All updates are immutable: new message/array references are
 * created for modified items so React.memo can detect changes.
 */

import type {
  MessageStartEvent,
  MessageDoneEvent,
  StepStartEvent,
  StepFinishEvent,
  MessagePart,
} from '@coding-assistant/shared';
import type { SessionState, MessageMetadata } from '../event-store';
import {
  findMessage,
  pushMessage,
  lastAssistantMessage,
  replaceMessage,
  immutablePushPart,
} from './helpers';

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

  // Immutably update modelId if provided
  if (event.modelId) {
    replaceMessage(session, { ...msg, modelId: event.modelId });
  }

  // Store metadata using the proper typed map
  session.messageMetadata.set(msg.id, {
    finishReason: event.finishReason,
    usage: event.usage,
    totalCost: event.totalCost,
  });

  // Accumulate cumulative usage and cost
  if (event.usage) {
    session.cumulativeUsage = {
      inputTokens: session.cumulativeUsage.inputTokens + event.usage.inputTokens,
      outputTokens: session.cumulativeUsage.outputTokens + event.usage.outputTokens,
      totalTokens: session.cumulativeUsage.totalTokens + event.usage.totalTokens,
    };
  }
  if (event.totalCost != null) {
    session.cumulativeCost += event.totalCost;
  }
}

export function applyStepStart(session: SessionState, event: StepStartEvent): void {
  const msg = findMessage(session, event.messageId) ?? lastAssistantMessage(session);
  if (!msg) return;
  immutablePushPart(session, msg, {
    type: 'step-start',
    id: `part_${Date.now()}_ss`,
    index: msg.parts.length,
    stepNumber: event.stepNumber,
  } as MessagePart);
}

export function applyStepFinish(session: SessionState, event: StepFinishEvent): void {
  const msg = findMessage(session, event.messageId) ?? lastAssistantMessage(session);
  if (!msg) return;
  immutablePushPart(session, msg, {
    type: 'step-finish',
    id: `part_${Date.now()}_sf`,
    index: msg.parts.length,
    stepNumber: event.stepNumber,
    finishReason: event.finishReason,
    usage: event.usage,
    cost: event.cost,
  } as MessagePart);
}
