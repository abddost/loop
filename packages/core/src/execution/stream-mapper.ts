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
  output: unknown,
  isError: boolean,
  durationMs?: number,
): RawStreamEvent {
  return {
    type: 'tool-result',
    ...base(scope),
    messageId: scope.messageId,
    toolCallId,
    toolName,
    result: output,
    isError,
    status: 'completed',
    ...(durationMs != null ? { durationMs } : {}),
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

// ── File patches ────────────────────────────────────────────────────

export function mapFilePatch(
  scope: EventScope,
  stepNumber: number,
  patch: { files: Array<{ path: string; change: 'added' | 'modified' | 'deleted'; mtime?: number }> },
): RawStreamEvent {
  return {
    type: 'file-patch',
    ...base(scope),
    messageId: scope.messageId,
    stepNumber,
    files: patch.files,
  } as RawStreamEvent;
}

// ── Compaction ──────────────────────────────────────────────────────

export function mapCompactionStart(
  scope: EventScope,
  metrics: { messagesToCompact: number; estimatedTokens: number },
): RawStreamEvent {
  return {
    type: 'compaction-start',
    ...base(scope),
    messageId: scope.messageId,
    messagesToCompact: metrics.messagesToCompact,
    estimatedTokens: metrics.estimatedTokens,
  } as RawStreamEvent;
}

export function mapCompactionDone(
  scope: EventScope,
  metrics: { messagesCompacted: number; tokensFreed: number; summaryTokens: number },
): RawStreamEvent {
  return {
    type: 'compaction-done',
    ...base(scope),
    messageId: scope.messageId,
    messagesCompacted: metrics.messagesCompacted,
    tokensFreed: metrics.tokensFreed,
    summaryTokens: metrics.summaryTokens,
  } as RawStreamEvent;
}

// ── Context pruning ────────────────────────────────────────────────

export function mapContextPruned(
  scope: EventScope,
  metrics: {
    prunedCount: number;
    prunedTokens: number;
    contextLimit: number;
    tokensBefore: number;
    tokensAfter: number;
  },
): RawStreamEvent {
  return {
    type: 'context-pruned',
    ...base(scope),
    messageId: scope.messageId,
    prunedCount: metrics.prunedCount,
    prunedTokens: metrics.prunedTokens,
    contextLimit: metrics.contextLimit,
    tokensBefore: metrics.tokensBefore,
    tokensAfter: metrics.tokensAfter,
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

// ── Subagent lifecycle ──────────────────────────────────────────────

export function mapSubagentStart(
  scope: EventScope,
  toolCallId: string,
  childSessionId: string,
  agentType: string,
  description: string,
  resumed: boolean,
): RawStreamEvent {
  return {
    type: 'subagent-start',
    ...base(scope),
    messageId: scope.messageId,
    toolCallId,
    childSessionId,
    agentType,
    description,
    resumed,
  } as RawStreamEvent;
}

export function mapSubagentChildEvent(
  scope: EventScope,
  toolCallId: string,
  childSessionId: string,
  childEvent: Record<string, unknown>,
): RawStreamEvent {
  return {
    type: 'subagent-child-event',
    ...base(scope),
    messageId: scope.messageId,
    toolCallId,
    childSessionId,
    childEvent,
  } as RawStreamEvent;
}

export function mapSubagentDone(
  scope: EventScope,
  toolCallId: string,
  childSessionId: string,
  agentType: string,
  durationMs: number,
  resultLength: number,
  error?: string,
): RawStreamEvent {
  return {
    type: 'subagent-done',
    ...base(scope),
    messageId: scope.messageId,
    toolCallId,
    childSessionId,
    agentType,
    durationMs,
    resultLength,
    ...(error ? { error } : {}),
  } as RawStreamEvent;
}
