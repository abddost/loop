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
  | PermissionResponseEvent
  | FilePatchEvent
  | CompactionStartEvent
  | CompactionDoneEvent
  | ContextPrunedEvent
  | SessionTitleUpdatedEvent
  | TasksChangedEvent
  | SubagentStartEvent
  | SubagentChildEvent
  | SubagentDoneEvent
  | BashOutputEvent;

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
  /** Tool execution output. SSE events still use `result` for backward compat. */
  result: unknown;
  isError: boolean;
  /** Tool state: completed */
  status: 'completed';
  /** Duration of tool execution in milliseconds */
  durationMs?: number;
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
  /** Tool input so the UI can display what's being requested */
  input?: unknown;
}

export interface PermissionResponseEvent extends StreamEventBase {
  type: 'permission-response';
  requestId: string;
  granted: boolean;
  /** Grant mode: 'once' for single use, 'always' for persistent */
  mode?: 'once' | 'always';
  /** Scope pattern for 'always' grants */
  scopePattern?: string;
  /** User-provided feedback when denying */
  feedback?: string;
}

/** Emitted after a step finishes with a list of files changed during that step. */
export interface FilePatchEvent extends StreamEventBase {
  type: 'file-patch';
  messageId: string;
  stepNumber: number;
  files: Array<{
    path: string;
    change: 'added' | 'modified' | 'deleted';
    mtime?: number;
  }>;
}

/** Emitted when LLM-based compaction starts. */
export interface CompactionStartEvent extends StreamEventBase {
  type: 'compaction-start';
  messageId: string;
  messagesToCompact: number;
  estimatedTokens: number;
}

/** Emitted when LLM-based compaction completes. */
export interface CompactionDoneEvent extends StreamEventBase {
  type: 'compaction-done';
  messageId: string;
  messagesCompacted: number;
  tokensFreed: number;
  summaryTokens: number;
}

/** Emitted when context pruning removes older messages. */
export interface ContextPrunedEvent extends StreamEventBase {
  type: 'context-pruned';
  messageId: string;
  prunedCount: number;
  prunedTokens: number;
  contextLimit: number;
  tokensBefore: number;
  tokensAfter: number;
}

/** Emitted when an auto-generated title is set for the session. */
export interface SessionTitleUpdatedEvent extends StreamEventBase {
  type: 'session-title-updated';
  title: string;
}

/** Emitted when a session's task list changes (create/update/delete). */
export interface TasksChangedEvent extends StreamEventBase {
  type: 'tasks-changed';
  taskListId: string;
  version: number;
  totalTasks: number;
  completedTasks: number;
}

// --- Subagent lifecycle events ---

/** Emitted when a subagent session starts execution. */
export interface SubagentStartEvent extends StreamEventBase {
  type: 'subagent-start';
  messageId: string;
  toolCallId: string;
  childSessionId: string;
  agentType: string;
  description: string;
  resumed: boolean;
}

/** Emitted for each child event forwarded from the subagent's stream. */
export interface SubagentChildEvent extends StreamEventBase {
  type: 'subagent-child-event';
  messageId: string;
  toolCallId: string;
  childSessionId: string;
  childEvent: {
    type: string;
    [key: string]: unknown;
  };
}

/** Emitted when a subagent session completes or errors. */
export interface SubagentDoneEvent extends StreamEventBase {
  type: 'subagent-done';
  messageId: string;
  toolCallId: string;
  childSessionId: string;
  agentType: string;
  durationMs: number;
  resultLength: number;
  error?: string;
}

/** Emitted for real-time bash output streaming. */
export interface BashOutputEvent extends StreamEventBase {
  type: 'bash-output';
  messageId: string;
  toolCallId: string;
  chunk: string;
  stream: 'stdout' | 'stderr';
  totalBytes: number;
}
