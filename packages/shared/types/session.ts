/**
 * Session types -- one session per active conversation within a workspace.
 */

export type SessionStatus = 'idle' | 'busy' | 'retry' | 'error';

export type MessageRole = 'user' | 'assistant' | 'tool';

export type FinishReason =
  | 'stop'
  | 'length'
  | 'tool-calls'
  | 'content-filter'
  | 'error'
  | 'other';

export interface SessionInfo {
  id: string;
  workspaceId: string;
  title: string;
  status: SessionStatus;
  agentId: string;
  parentSessionId: string | null;
  forkMessageIndex: number | null;
  summaryText: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  index: number;
  modelId: string | null;
  finishReason: FinishReason | null;
  usage: TokenUsage | null;
  error: MessageError | null;
  parts: MessagePart[];
  createdAt: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface MessageError {
  code: string;
  message: string;
  details?: unknown;
}

// --- Message Parts (discriminated union) ---

export type MessagePartType =
  | 'text'
  | 'tool-call'
  | 'tool-result'
  | 'reasoning'
  | 'source'
  | 'file'
  | 'step-start'
  | 'step-finish'
  | 'error';

export type MessagePart =
  | StartPart
  | TextPart
  | ToolCallPart
  | ToolResultPart
  | ReasoningPart
  | SourcePart
  | FilePart
  | StepStartPart
  | StepFinishPart
  | ErrorPart;

/** Status of a tool call through its lifecycle */
export type ToolStatus = 'pending' | 'running' | 'completed' | 'error';

export interface StartPart {
  type: 'start';
  id: string;
  index: number;
}

export interface TextPart {
  type: 'text';
  id: string;
  index: number;
  text: string;
}

export interface ToolCallPart {
  type: 'tool-call';
  id: string;
  index: number;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** Lifecycle status: pending -> running -> completed | error */
  status: ToolStatus;
}

export interface ToolResultPart {
  type: 'tool-result';
  id: string;
  index: number;
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

export interface ReasoningPart {
  type: 'reasoning';
  id: string;
  index: number;
  text: string;
}

export interface SourcePart {
  type: 'source';
  id: string;
  index: number;
  url: string;
  title: string | null;
}

export interface FilePart {
  type: 'file';
  id: string;
  index: number;
  filePath: string;
  mimeType: string;
  data: string; // base64
}

export interface StepStartPart {
  type: 'step-start';
  id: string;
  index: number;
  stepNumber: number;
}

export interface StepFinishPart {
  type: 'step-finish';
  id: string;
  index: number;
  stepNumber: number;
  finishReason: FinishReason;
  usage: TokenUsage | null;
  cost?: number;
}

/** Explicit error part -- rendered differently from text */
export interface ErrorPart {
  type: 'error';
  id: string;
  index: number;
  code: string;
  message: string;
}

// --- UI Message (assembled from parts for rendering) ---

export interface UIMessage {
  id: string;
  role: MessageRole;
  parts: MessagePart[];
  modelId: string | null;
  createdAt: string;
}

// --- Type guards for runtime discrimination ---

export function isTextPart(part: MessagePart): part is TextPart {
  return part.type === 'text';
}

export function isToolCallPart(part: MessagePart): part is ToolCallPart {
  return part.type === 'tool-call';
}

export function isToolResultPart(part: MessagePart): part is ToolResultPart {
  return part.type === 'tool-result';
}

export function isReasoningPart(part: MessagePart): part is ReasoningPart {
  return part.type === 'reasoning';
}

export function isStepStartPart(part: MessagePart): part is StepStartPart {
  return part.type === 'step-start';
}

export function isStepFinishPart(part: MessagePart): part is StepFinishPart {
  return part.type === 'step-finish';
}

export function isErrorPart(part: MessagePart): part is ErrorPart {
  return part.type === 'error';
}
