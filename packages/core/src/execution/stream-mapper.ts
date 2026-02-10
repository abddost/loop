/**
 * Stream Mapper -- maps AI SDK fullStream parts to StreamEvent objects.
 *
 * Each function returns Omit<StreamEvent, 'globalSeq'> because the
 * GlobalEventBus assigns the monotonic sequence number on emit().
 */

import type {
  StreamEvent,
  TokenUsage,
  FinishReason,
} from '@coding-assistant/shared';

/** A StreamEvent without globalSeq (assigned by the bus). */
export type RawStreamEvent = Omit<StreamEvent, 'globalSeq'>;

/** Shared fields injected into every event. */
interface EventScope {
  workspaceId: string;
  sessionId: string;
  messageId: string;
}

function base(scope: EventScope): Pick<RawStreamEvent, 'workspaceId' | 'sessionId' | 'timestamp'> {
  return {
    workspaceId: scope.workspaceId,
    sessionId: scope.sessionId,
    timestamp: new Date().toISOString(),
  };
}

// ── Text lifecycle ──────────────────────────────────────────────────

export function mapTextStart(scope: EventScope, partId: string): RawStreamEvent {
  return {
    type: 'text-start',
    ...base(scope),
    messageId: scope.messageId,
    partId,
  } as RawStreamEvent;
}

export function mapTextDelta(scope: EventScope, delta: string, partId?: string): RawStreamEvent {
  return {
    type: 'text-delta',
    ...base(scope),
    messageId: scope.messageId,
    partId,
    delta,
  } as RawStreamEvent;
}

export function mapTextDone(scope: EventScope, text: string, partId?: string): RawStreamEvent {
  return {
    type: 'text-done',
    ...base(scope),
    messageId: scope.messageId,
    partId,
    text,
  } as RawStreamEvent;
}

// ── Tool lifecycle ──────────────────────────────────────────────────

export function mapToolCallStart(
  scope: EventScope,
  toolCallId: string,
  toolName: string,
): RawStreamEvent {
  return {
    type: 'tool-call-start',
    ...base(scope),
    messageId: scope.messageId,
    toolCallId,
    toolName,
    status: 'pending',
  } as RawStreamEvent;
}

export function mapToolCallDone(
  scope: EventScope,
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
): RawStreamEvent {
  return {
    type: 'tool-call-done',
    ...base(scope),
    messageId: scope.messageId,
    toolCallId,
    toolName,
    args,
    status: 'running',
  } as RawStreamEvent;
}

export function mapToolResult(
  scope: EventScope,
  toolCallId: string,
  toolName: string,
  result: unknown,
  isError: boolean,
): RawStreamEvent {
  return {
    type: 'tool-result',
    ...base(scope),
    messageId: scope.messageId,
    toolCallId,
    toolName,
    result,
    isError,
    status: 'completed',
  } as RawStreamEvent;
}

export function mapToolError(
  scope: EventScope,
  toolCallId: string,
  toolName: string,
  error: string,
): RawStreamEvent {
  return {
    type: 'tool-error',
    ...base(scope),
    messageId: scope.messageId,
    toolCallId,
    toolName,
    error,
    status: 'error',
  } as RawStreamEvent;
}

// ── Reasoning lifecycle ─────────────────────────────────────────────

export function mapReasoningStart(scope: EventScope, partId: string): RawStreamEvent {
  return {
    type: 'reasoning-start',
    ...base(scope),
    messageId: scope.messageId,
    partId,
  } as RawStreamEvent;
}

export function mapReasoningDelta(scope: EventScope, delta: string, partId?: string): RawStreamEvent {
  return {
    type: 'reasoning-delta',
    ...base(scope),
    messageId: scope.messageId,
    partId,
    delta,
  } as RawStreamEvent;
}

export function mapReasoningDone(scope: EventScope, partId: string, text: string): RawStreamEvent {
  return {
    type: 'reasoning-done',
    ...base(scope),
    messageId: scope.messageId,
    partId,
    text,
  } as RawStreamEvent;
}

// ── Step lifecycle ──────────────────────────────────────────────────

export function mapStepStart(
  scope: EventScope,
  stepNumber: number,
): RawStreamEvent {
  return {
    type: 'step-start',
    ...base(scope),
    messageId: scope.messageId,
    stepNumber,
  } as RawStreamEvent;
}

export function mapStepFinish(
  scope: EventScope,
  stepNumber: number,
  finishReason: FinishReason,
  usage: TokenUsage | null,
  cost?: number,
): RawStreamEvent {
  return {
    type: 'step-finish',
    ...base(scope),
    messageId: scope.messageId,
    stepNumber,
    finishReason,
    usage,
    cost,
  } as RawStreamEvent;
}

// ── Message lifecycle ───────────────────────────────────────────────

export function mapMessageStart(
  scope: EventScope,
  role: 'user' | 'assistant',
): RawStreamEvent {
  return {
    type: 'message-start',
    ...base(scope),
    messageId: scope.messageId,
    role,
  } as RawStreamEvent;
}

export function mapMessageDone(
  scope: EventScope,
  finishReason: FinishReason,
  usage: TokenUsage | null,
  modelId?: string,
  totalCost?: number,
): RawStreamEvent {
  return {
    type: 'message-done',
    ...base(scope),
    messageId: scope.messageId,
    modelId,
    finishReason,
    usage,
    totalCost,
  } as RawStreamEvent;
}

// ── Session status ──────────────────────────────────────────────────

export function mapSessionStatus(
  scope: Omit<EventScope, 'messageId'>,
  status: string,
  retryInfo?: { attempt: number; reason: string; nextAt: number },
): RawStreamEvent {
  return {
    type: 'session-status',
    ...base({ ...scope, messageId: '' }),
    status,
    ...(retryInfo ? {
      retryAttempt: retryInfo.attempt,
      retryReason: retryInfo.reason,
      retryNextAt: retryInfo.nextAt,
    } : {}),
  } as RawStreamEvent;
}

// ── Error ───────────────────────────────────────────────────────────

export function mapError(
  scope: Omit<EventScope, 'messageId'>,
  code: string,
  message: string,
): RawStreamEvent {
  return {
    type: 'error',
    ...base({ ...scope, messageId: '' }),
    code,
    message,
  } as RawStreamEvent;
}
