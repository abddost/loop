/**
 * Stream event types -- always carry workspaceId + sessionId.
 * The global SSE pipe broadcasts these with a globalSeq.
 */

import type { TokenUsage, FinishReason, MessageRole } from './session.js';

/**
 * Every event carries workspace + session scope.
 * globalSeq is assigned by the GlobalEventBus.
 */
export interface StreamEventBase {
  globalSeq: number;
  workspaceId: string;
  sessionId: string;
  timestamp: string;
}

// --- Event type union ---

export type StreamEvent =
  | SessionStatusEvent
  | MessageStartEvent
  | TextStartEvent
  | TextDeltaEvent
  | TextDoneEvent
  | ToolCallStartEvent
  | ToolCallDeltaEvent
  | ToolCallDoneEvent
  | ToolResultEvent
  | ToolErrorEvent
  | ReasoningStartEvent
  | ReasoningDeltaEvent
  | ReasoningDoneEvent
  | StepStartEvent
  | StepFinishEvent
  | MessageDoneEvent
  | ErrorEvent
  | PermissionRequestEvent
  | PermissionResponseEvent;

export type StreamEventType = StreamEvent['type'];

// --- Individual event types ---

export interface SessionStatusEvent extends StreamEventBase {
  type: 'session-status';
  status: string;
  /** Retry metadata -- present when status is 'retry' */
  retryAttempt?: number;
  retryReason?: string;
  retryNextAt?: number;
}

export interface MessageStartEvent extends StreamEventBase {
  type: 'message-start';
  messageId: string;
  role: MessageRole;
}

/** Marks the beginning of a new text part (one per step) */
export interface TextStartEvent extends StreamEventBase {
  type: 'text-start';
  messageId: string;
  partId: string;
}

export interface TextDeltaEvent extends StreamEventBase {
  type: 'text-delta';
  messageId: string;
  /** Correlates deltas to a specific text part opened by text-start */
  partId?: string;
  delta: string;
}

export interface TextDoneEvent extends StreamEventBase {
  type: 'text-done';
  messageId: string;
  partId?: string;
  text: string;
}

export interface ToolCallStartEvent extends StreamEventBase {
  type: 'tool-call-start';
  messageId: string;
  toolCallId: string;
  toolName: string;
  /** Tool state: pending means args are still streaming */
  status: 'pending';
}

export interface ToolCallDeltaEvent extends StreamEventBase {
  type: 'tool-call-delta';
  messageId: string;
  toolCallId: string;
  delta: string;
}

export interface ToolCallDoneEvent extends StreamEventBase {
  type: 'tool-call-done';
  messageId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** Tool state: running means tool execution has started */
  status: 'running';
}

export interface ToolResultEvent extends StreamEventBase {
  type: 'tool-result';
  messageId: string;
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
  /** Tool state: completed */
  status: 'completed';
}

/** Explicit tool error event (separate from tool-result with isError) */
export interface ToolErrorEvent extends StreamEventBase {
  type: 'tool-error';
  messageId: string;
  toolCallId: string;
  toolName: string;
  error: string;
  status: 'error';
}

/** Marks the beginning of a reasoning section */
export interface ReasoningStartEvent extends StreamEventBase {
  type: 'reasoning-start';
  messageId: string;
  partId: string;
}

export interface ReasoningDeltaEvent extends StreamEventBase {
  type: 'reasoning-delta';
  messageId: string;
  partId?: string;
  delta: string;
}

/** Marks the end of a reasoning section */
export interface ReasoningDoneEvent extends StreamEventBase {
  type: 'reasoning-done';
  messageId: string;
  partId: string;
  text: string;
}

export interface StepStartEvent extends StreamEventBase {
  type: 'step-start';
  messageId: string;
  stepNumber: number;
}

export interface StepFinishEvent extends StreamEventBase {
  type: 'step-finish';
  messageId: string;
  stepNumber: number;
  finishReason: FinishReason;
  usage: TokenUsage | null;
  /** Estimated cost in USD for this step (if known) */
  cost?: number;
}

export interface MessageDoneEvent extends StreamEventBase {
  type: 'message-done';
  messageId: string;
  modelId?: string;
  finishReason: FinishReason;
  usage: TokenUsage | null;
  /** Total estimated cost in USD for the entire message */
  totalCost?: number;
}

export interface ErrorEvent extends StreamEventBase {
  type: 'error';
  code: string;
  message: string;
  details?: unknown;
}

export interface PermissionRequestEvent extends StreamEventBase {
  type: 'permission-request';
  requestId: string;
  toolName: string;
  domain: string;
  description: string;
  riskLevel: string;
}

export interface PermissionResponseEvent extends StreamEventBase {
  type: 'permission-response';
  requestId: string;
  granted: boolean;
}
