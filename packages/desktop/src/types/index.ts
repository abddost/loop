/**
 * Consolidated frontend types.
 *
 * Single source of truth for all UI-specific interfaces.
 * Shared types are re-exported from @coding-assistant/shared so components
 * only ever import from `../types` -- never directly from the shared package.
 */

// Re-export shared types consumed by frontend components
export type {
  // Session / message
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
  FilePatchPart,
  CompactionPart,
  ContextPrunedPart,
  ToolStatus,
  TokenUsage,
  PermissionRequest,
  StreamEvent,

  // Provider catalog & connection (single source -- no local redeclaration)
  ProviderCatalogEntry,
  ProviderCredentialField,
  ProviderConnectionStatus,
  ConnectionTestResult,
  ModelCapabilities,

  // Auth types for multi-method provider authentication
  AuthMethod,
  AuthFlowType,
  OAuthAuthorization,
} from '@coding-assistant/shared';

// Local import needed by response shapes below
import type { MessagePart, AuthMethod, OAuthAuthorization } from '@coding-assistant/shared';

// ---------------------------------------------------------------------------
//  Agents
// ---------------------------------------------------------------------------

export interface AgentInfo {
  id: string;
  name: string;
  description: string;
  capabilities: {
    canWrite: boolean;
    canShell: boolean;
    canWeb: boolean;
    maxSteps: number;
  };
}

export interface ListAgentsResponse {
  agents: AgentInfo[];
}

// ---------------------------------------------------------------------------
//  Tasks
// ---------------------------------------------------------------------------

export interface TaskItem {
  id: string;
  subject: string;
  description: string;
  activeForm: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  blocks: string[];
  blockedBy: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PlanInfo {
  planId: string;
  filename: string;
}

export interface PlanDetail {
  planId: string;
  title: string;
  created: string;
  workspace: string;
  content: string;
}

// ---------------------------------------------------------------------------
//  API response shapes for tasks and plans
// ---------------------------------------------------------------------------

export interface ListTasksResponse {
  tasks: TaskItem[];
  version: number;
}

export interface UpdateTasksResponse {
  created: number;
  updated: number;
  total: number;
  version: number;
}

export interface ListPlansResponse {
  plans: PlanInfo[];
}

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
  title?: string;
  agentId: string;
  status: string;
  messageCount?: number;
  createdAt?: string;
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

/**
 * Frontend model entry.
 *
 * `capabilities` uses the shared `ModelCapabilities` type which includes
 * all fields the backend catalog now provides (attachment, temperature,
 * input/output modality sets, etc.).
 */
export interface ModelEntry {
  id: string;
  providerId: string;
  name: string;
  description: string;
  enabled: boolean;
  limits: { context: number; maxOutput: number };
  capabilities: import('@coding-assistant/shared').ModelCapabilities;
}

export interface ModelGroup {
  provider: {
    id: string;
    name: string;
    description: string;
    website: string;
  };
  connected: boolean;
  /** Total number of models for this provider (before any client-side truncation). */
  totalModels: number;
  models: ModelEntry[];
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
    title?: string;
    agentId: string;
    status: string;
    createdAt?: string;
  }>;
}

export interface CreateSessionResponse {
  session: { id: string; workspaceId: string; agentId: string; createdAt?: string };
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
  connected: import('@coding-assistant/shared').ProviderCatalogEntry[];
  popular: import('@coding-assistant/shared').ProviderCatalogEntry[];
  other: import('@coding-assistant/shared').ProviderCatalogEntry[];
}

// ── OAuth endpoint responses ────────────────────────────────────────────

/** Response from GET /api/providers/:id/auth-methods */
export interface AuthMethodsResponse {
  methods: AuthMethod[];
}

/**
 * Response from POST /api/providers/:id/oauth/authorize.
 *
 * This is structurally identical to `OAuthAuthorization` from shared --
 * we alias it here for clarity at the API boundary. Components that only
 * need the shape should import `OAuthAuthorization` directly.
 */
export type OAuthStartResponse = OAuthAuthorization;
