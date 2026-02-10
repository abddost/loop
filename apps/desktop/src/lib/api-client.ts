/**
 * Typed HTTP client for the server API.
 */

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
    return this.request<{ workspaces: Array<{
      id: string; name: string; rootPath: string; sessionCount: number;
    }> }>('/api/workspaces');
  }

  async openWorkspace(rootPath: string) {
    return this.request<{ workspace: { id: string; name: string; rootPath: string } }>(
      '/api/workspaces',
      { method: 'POST', body: JSON.stringify({ rootPath }) },
    );
  }

  async closeWorkspace(id: string) {
    return this.request<{ success: boolean }>(`/api/workspaces/${id}`, { method: 'DELETE' });
  }

  // Sessions
  async listSessions(workspaceId: string) {
    return this.request<{ sessions: Array<{
      id: string; workspaceId: string; agentId: string; status: string;
    }> }>(`/api/sessions?workspaceId=${workspaceId}`);
  }

  async createSession(workspaceId: string, agentId?: string) {
    return this.request<{ session: { id: string; workspaceId: string; agentId: string } }>(
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
  async sendMessage(workspaceId: string, sessionId: string, content: string) {
    return this.request<{ status: string; sessionId: string }>(
      '/api/messages',
      { method: 'POST', body: JSON.stringify({ workspaceId, sessionId, content }) },
    );
  }

  async getMessages(workspaceId: string, sessionId: string) {
    return this.request<{ messages: unknown[] }>(
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
  async listModels() {
    return this.request<{ models: unknown[]; total: number }>('/api/models');
  }

  async refreshModels() {
    return this.request<{ success: boolean }>('/api/models/refresh', { method: 'POST' });
  }

  async listModelsGrouped() {
    return this.request<{
      groups: Array<{
        provider: { id: string; name: string; description: string; website: string };
        connected: boolean;
        models: Array<{
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
        }>;
      }>;
    }>('/api/models/grouped');
  }

  async toggleModel(modelId: string, enabled: boolean) {
    return this.request<{ success: boolean }>(
      '/api/models/toggle',
      { method: 'POST', body: JSON.stringify({ modelId, enabled }) },
    );
  }

  // Providers (global -- no workspaceId)
  async listProviders() {
    return this.request<{
      connected: ProviderCatalogEntry[];
      popular: ProviderCatalogEntry[];
      other: ProviderCatalogEntry[];
    }>('/api/providers');
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
}

// Re-export types used by components consuming ApiClient
export type { ProviderCatalogEntry, ConnectionTestResult };

/** Inline type definitions for the API client (avoids importing from shared in the frontend) */
interface ProviderCatalogEntry {
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

interface ConnectionTestResult {
  success: boolean;
  providerId: string;
  latencyMs?: number;
  errorMessage?: string;
  modelsAvailable?: number;
}
