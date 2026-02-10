/**
 * Workspace state hook.
 */

import { useState, useCallback } from 'react';
import type { ApiClient } from '../lib/api-client';

interface WorkspaceInfo {
  id: string;
  name: string;
  rootPath: string;
  sessionCount: number;
}

export function useWorkspace(apiClient: ApiClient | null) {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!apiClient) return;
    setLoading(true);
    try {
      const result = await apiClient.listWorkspaces();
      setWorkspaces(result.workspaces);
    } catch (err) {
      console.error('Failed to list workspaces:', err);
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  const open = useCallback(async (rootPath: string) => {
    if (!apiClient) return;
    setLoading(true);
    try {
      const result = await apiClient.openWorkspace(rootPath);
      setActiveWorkspaceId(result.workspace.id);
      await refresh();
      return result.workspace;
    } catch (err) {
      console.error('Failed to open workspace:', err);
    } finally {
      setLoading(false);
    }
  }, [apiClient, refresh]);

  const close = useCallback(async (id: string) => {
    if (!apiClient) return;
    try {
      await apiClient.closeWorkspace(id);
      if (activeWorkspaceId === id) {
        setActiveWorkspaceId(null);
      }
      await refresh();
    } catch (err) {
      console.error('Failed to close workspace:', err);
    }
  }, [apiClient, activeWorkspaceId, refresh]);

  return {
    workspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    loading,
    refresh,
    open,
    close,
  };
}
