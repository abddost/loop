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
  AuthMethodsResponse,
  OAuthStartResponse,
} from '../types';

export class ApiClient {
  private baseUrl: string;
  private authToken: string;

  constructor(baseUrl: string, authToken: string) {
    this.baseUrl = baseUrl;
    this.authToken = authToken;
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
    return this.request<ListWorkspacesResponse>('/api/workspaces');
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
    return this.request<ListSessionsResponse>(`/api/sessions?workspaceId=${workspaceId}`);
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

  // Messages
  async sendMessage(workspaceId: string, sessionId: string, content: string, model?: string, messageId?: string) {
    return this.request<SendMessageResponse>(
      '/api/messages',
      { method: 'POST', body: JSON.stringify({ workspaceId, sessionId, content, model, messageId }) },
    );
  }

  async getMessages(workspaceId: string, sessionId: string) {
    return this.request<SessionDetailResponse>(
      `/api/messages?workspaceId=${workspaceId}&sessionId=${sessionId}`,
    );
  }

  // Permissions
  async respondToPermission(requestId: string, granted: boolean, mode: 'once' | 'always' = 'once') {
    return this.request<{ success: boolean }>(
      '/api/permissions/respond',
      { method: 'POST', body: JSON.stringify({ requestId, granted, mode }) },
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
  async getSessionDetail(workspaceId: string, sessionId: string) {
    return this.request<SessionDetailResponse>(
      `/api/sessions/${sessionId}?workspaceId=${workspaceId}`,
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
}

// Re-export types that components consuming ApiClient need
export type { ProviderCatalogEntry, ConnectionTestResult } from '../types';
