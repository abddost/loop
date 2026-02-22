/**
 * Typed HTTP client for the server API.
 *
 * All response shapes are defined in `types/index.ts` -- no inline types here.
 */

import type {
  ProviderCatalogEntry,
  ConnectionTestResult,
  ListWorkspacesResponse,
  OpenWorkspaceResponse,
  ListSessionsResponse,
  CreateSessionResponse,
  SendMessageResponse,
  SessionDetailResponse,
  ListModelsGroupedResponse,
  ListProvidersResponse,
  ListAgentsResponse,
  AuthMethodsResponse,
  OAuthStartResponse,
  ListTasksResponse,
  UpdateTasksResponse,
  TaskItem,
  ListPlansResponse,
  PlanDetail,
} from '../types';

export class ApiClient {
  private baseUrl: string;
  private authToken: string;
  private inflight = new Map<string, Promise<unknown>>();

  constructor(baseUrl: string, authToken: string) {
    this.baseUrl = baseUrl;
    this.authToken = authToken;
  }

  /**
   * Deduplicate concurrent identical requests.
   * If a request with the same key is already in-flight, returns the existing promise.
   */
  private async deduplicated<T>(key: string, factory: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const promise = factory().finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.authToken}`,
        ...options?.headers,
      },
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new Error(error.error?.message ?? `HTTP ${res.status}`);
    }

    return res.json();
  }

  // Workspaces
  async listWorkspaces() {
    return this.deduplicated('listWorkspaces', () =>
      this.request<ListWorkspacesResponse>('/api/workspaces'),
    );
  }

  async openWorkspace(rootPath: string) {
    return this.request<OpenWorkspaceResponse>(
      '/api/workspaces',
      { method: 'POST', body: JSON.stringify({ rootPath }) },
    );
  }

  async closeWorkspace(id: string) {
    return this.request<{ success: boolean }>(`/api/workspaces/${id}`, { method: 'DELETE' });
  }

  // Sessions
  async listSessions(workspaceId: string) {
    return this.deduplicated(`listSessions:${workspaceId}`, () =>
      this.request<ListSessionsResponse>(`/api/sessions?workspaceId=${workspaceId}`),
    );
  }

  async createSession(workspaceId: string, agentId?: string) {
    return this.request<CreateSessionResponse>(
      '/api/sessions',
      { method: 'POST', body: JSON.stringify({ workspaceId, agentId }) },
    );
  }

  async deleteSession(workspaceId: string, sessionId: string) {
    return this.request<{ success: boolean }>(
      `/api/sessions/${sessionId}?workspaceId=${workspaceId}`,
      { method: 'DELETE' },
    );
  }

  async cancelSession(workspaceId: string, sessionId: string) {
    return this.request<{ success: boolean }>(
      `/api/sessions/${sessionId}/cancel?workspaceId=${workspaceId}`,
      { method: 'POST' },
    );
  }

  // Agents
  async listAgents() {
    return this.request<ListAgentsResponse>('/api/agents');
  }

  // Messages
  async sendMessage(workspaceId: string, sessionId: string, content: string, model?: string, messageId?: string, agentId?: string, effort?: string, hidden?: boolean) {
    return this.request<SendMessageResponse>(
      '/api/messages',
      { method: 'POST', body: JSON.stringify({ workspaceId, sessionId, content, model, messageId, agentId, effort, hidden }) },
    );
  }

  async getMessages(workspaceId: string, sessionId: string) {
    return this.request<SessionDetailResponse>(
      `/api/messages?workspaceId=${workspaceId}&sessionId=${sessionId}`,
    );
  }

  // Permissions
  async respondToPermission(requestId: string, granted: boolean, mode: 'once' | 'always' = 'once', feedback?: string) {
    return this.request<{ success: boolean }>(
      '/api/permissions/respond',
      { method: 'POST', body: JSON.stringify({ requestId, granted, mode, feedback }) },
    );
  }

  // Models
  async listModelsGrouped() {
    return this.request<ListModelsGroupedResponse>('/api/models/grouped');
  }

  async toggleModel(modelId: string, enabled: boolean) {
    return this.request<{ success: boolean }>(
      '/api/models/toggle',
      { method: 'POST', body: JSON.stringify({ modelId, enabled }) },
    );
  }

  async getDefaultModel() {
    return this.request<{ defaultModel: string }>('/api/models/default');
  }

  async setDefaultModel(modelId: string) {
    return this.request<{ success: boolean; defaultModel: string }>(
      '/api/models/default',
      { method: 'POST', body: JSON.stringify({ modelId }) },
    );
  }

  // Session detail (for history hydration)
  async getSessionDetail(workspaceId: string, sessionId: string, pagination?: { limit: number; offset: number }) {
    const params = new URLSearchParams({ workspaceId });
    if (pagination) {
      params.set('limit', String(pagination.limit));
      params.set('offset', String(pagination.offset));
    }
    const key = `getSessionDetail:${sessionId}:${pagination?.limit ?? 'all'}:${pagination?.offset ?? 0}`;
    return this.deduplicated(key, () =>
      this.request<SessionDetailResponse>(
        `/api/sessions/${sessionId}?${params}`,
      ),
    );
  }

  // Providers (global -- no workspaceId)
  async listProviders() {
    return this.request<ListProvidersResponse>('/api/providers');
  }

  async getProvider(id: string) {
    return this.request<{ provider: ProviderCatalogEntry }>(`/api/providers/${id}`);
  }

  async connectProvider(id: string, credentials: Record<string, string>) {
    return this.request<ConnectionTestResult>(
      `/api/providers/${id}/connect`,
      { method: 'POST', body: JSON.stringify({ credentials }) },
    );
  }

  async disconnectProvider(id: string) {
    return this.request<{ success: boolean }>(
      `/api/providers/${id}/disconnect`,
      { method: 'DELETE' },
    );
  }

  async testProvider(id: string) {
    return this.request<ConnectionTestResult>(
      `/api/providers/${id}/test`,
      { method: 'POST' },
    );
  }

  // Provider auth (OAuth / multi-method)
  async getAuthMethods(providerId: string) {
    return this.request<AuthMethodsResponse>(
      `/api/providers/${providerId}/auth-methods`,
    );
  }

  async startOAuthFlow(providerId: string, methodId: string) {
    return this.request<OAuthStartResponse>(
      `/api/providers/${providerId}/oauth/authorize`,
      { method: 'POST', body: JSON.stringify({ methodId }) },
    );
  }

  async completeOAuthFlow(providerId: string, code?: string) {
    return this.request<{ success: boolean }>(
      `/api/providers/${providerId}/oauth/callback`,
      { method: 'POST', body: JSON.stringify(code ? { code } : {}) },
    );
  }

  async removeOAuthAuth(providerId: string) {
    return this.request<{ success: boolean }>(
      `/api/providers/${providerId}/oauth`,
      { method: 'DELETE' },
    );
  }

  // Tasks
  async getTasks(workspaceId: string, sessionId: string) {
    return this.request<ListTasksResponse>(
      `/api/tasks?workspaceId=${workspaceId}&sessionId=${sessionId}`,
    );
  }

  async updateTasks(workspaceId: string, sessionId: string, tasks: Array<Partial<TaskItem> & { subject: string }>) {
    return this.request<UpdateTasksResponse>(
      '/api/tasks',
      { method: 'POST', body: JSON.stringify({ workspaceId, sessionId, tasks }) },
    );
  }

  async deleteTask(workspaceId: string, sessionId: string, taskId: string) {
    return this.request<{ success: boolean }>(
      `/api/tasks/${taskId}?workspaceId=${workspaceId}&sessionId=${sessionId}`,
      { method: 'DELETE' },
    );
  }

  // Plans
  async listPlans() {
    return this.request<ListPlansResponse>('/api/plans');
  }

  async getPlan(planId: string) {
    return this.request<PlanDetail>(`/api/plans/${planId}`);
  }

  async savePlanToWorkspace(planId: string, workspaceId: string) {
    return this.request<{ success: boolean; path: string }>(
      `/api/plans/${planId}/save-to-workspace`,
      { method: 'POST', body: JSON.stringify({ workspaceId }) },
    );
  }
}

// Re-export types that components consuming ApiClient need
export type { ProviderCatalogEntry, ConnectionTestResult } from '../types';
