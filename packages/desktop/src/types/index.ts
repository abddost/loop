/**
 * Consolidated frontend types.
 *
 * Single source of truth for all UI-specific interfaces.
 * Shared types are re-exported from @coding-assistant/shared.
 */

// Re-export shared types consumed by frontend components
export type {
  SessionStatus,
  MessageRole,
  FinishReason,
  UIMessage,
  MessagePart,
  TextPart,
  ToolCallPart,
  ToolResultPart,
  ReasoningPart,
  ErrorPart,
  StepStartPart,
  StepFinishPart,
  ToolStatus,
  TokenUsage,
  PermissionRequest,
  StreamEvent,
} from '@coding-assistant/shared';

// ---------------------------------------------------------------------------
//  Workspace & Session
// ---------------------------------------------------------------------------

export interface WorkspaceInfo {
  id: string;
  name: string;
  rootPath: string;
  sessionCount: number;
}

export interface SessionInfo {
  id: string;
  workspaceId?: string;
  agentId: string;
  status: string;
  messageCount?: number;
}

// ---------------------------------------------------------------------------
//  Model selector
// ---------------------------------------------------------------------------

export interface ModelOption {
  id: string;       // e.g. "openai:gpt-4o"
  label: string;    // e.g. "GPT-4o"
  providerId: string;
}

export interface EffortOption {
  id: string;
  label: string;
}

// ---------------------------------------------------------------------------
//  Model management (useModels hook)
// ---------------------------------------------------------------------------

export interface ModelEntry {
  id: string;
  providerId: string;
  name: string;
  description: string;
  enabled: boolean;
  limits: { context: number; maxOutput: number };
  capabilities: {
    streaming: boolean;
    functionCalling: boolean;
    vision: boolean;
    reasoning: boolean;
    json: boolean;
  };
}

export interface ModelGroup {
  provider: {
    id: string;
    name: string;
    description: string;
    website: string;
  };
  connected: boolean;
  models: ModelEntry[];
}

// ---------------------------------------------------------------------------
//  Provider catalog (API & settings UI)
// ---------------------------------------------------------------------------

export interface ProviderCatalogEntry {
  id: string;
  name: string;
  description: string;
  website: string;
  iconUrl?: string;
  tier: 'popular' | 'other';
  credentialFields: Array<{
    key: string;
    label: string;
    type: 'secret' | 'text' | 'select';
    required: boolean;
    placeholder?: string;
    helpText?: string;
    options?: Array<{ value: string; label: string }>;
  }>;
  connectionStatus: 'connected' | 'disconnected' | 'error' | 'untested';
  modelCount: number;
  errorMessage?: string;
}

export interface ConnectionTestResult {
  success: boolean;
  providerId: string;
  latencyMs?: number;
  errorMessage?: string;
  modelsAvailable?: number;
}

// ---------------------------------------------------------------------------
//  API response shapes
// ---------------------------------------------------------------------------

export interface ListWorkspacesResponse {
  workspaces: WorkspaceInfo[];
}

export interface OpenWorkspaceResponse {
  workspace: { id: string; name: string; rootPath: string };
}

export interface ListSessionsResponse {
  sessions: Array<{
    id: string;
    workspaceId: string;
    agentId: string;
    status: string;
  }>;
}

export interface CreateSessionResponse {
  session: { id: string; workspaceId: string; agentId: string };
}

export interface SendMessageResponse {
  status: string;
  sessionId: string;
}

export interface SessionDetailResponse {
  session: {
    id: string;
    messages: Array<{
      id: string;
      role: string;
      parts: MessagePart[];
      modelId: string | null;
      createdAt: string;
    }>;
  };
}

export interface ListModelsGroupedResponse {
  groups: ModelGroup[];
}

export interface ListProvidersResponse {
  connected: ProviderCatalogEntry[];
  popular: ProviderCatalogEntry[];
  other: ProviderCatalogEntry[];
}

// Re-import MessagePart for the response type above
import type { MessagePart } from '@coding-assistant/shared';
