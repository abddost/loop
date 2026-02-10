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
  | TextDeltaEvent
  | TextDoneEvent
  | ToolCallStartEvent
  | ToolCallDeltaEvent
  | ToolCallDoneEvent
  | ToolResultEvent
  | ReasoningDeltaEvent
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
}

export interface MessageStartEvent extends StreamEventBase {
  type: 'message-start';
  messageId: string;
  role: MessageRole;
}

export interface TextDeltaEvent extends StreamEventBase {
  type: 'text-delta';
  messageId: string;
  delta: string;
}

export interface TextDoneEvent extends StreamEventBase {
  type: 'text-done';
  messageId: string;
  text: string;
}

export interface ToolCallStartEvent extends StreamEventBase {
  type: 'tool-call-start';
  messageId: string;
  toolCallId: string;
  toolName: string;
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
}

export interface ToolResultEvent extends StreamEventBase {
  type: 'tool-result';
  messageId: string;
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

export interface ReasoningDeltaEvent extends StreamEventBase {
  type: 'reasoning-delta';
  messageId: string;
  delta: string;
}

export interface StepStartEvent extends StreamEventBase {
  type: 'step-start';
  stepNumber: number;
}

export interface StepFinishEvent extends StreamEventBase {
  type: 'step-finish';
  stepNumber: number;
  finishReason: FinishReason;
  usage: TokenUsage | null;
}

export interface MessageDoneEvent extends StreamEventBase {
  type: 'message-done';
  messageId: string;
  finishReason: FinishReason;
  usage: TokenUsage | null;
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
