/**
 * useWorkspace -- manages workspace list, active workspace, and persistence.
 *
 * Validates persisted workspace ID against server state on mount.
 * Provides open/close/refresh operations.
 */

import { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '../lib/api-client-provider';
import { STORAGE_KEYS } from '../constants';
import type { WorkspaceInfo } from '../types';

function loadPersistedId(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function persistId(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* ignore storage errors */ }
}

export function useWorkspace() {
  const apiClient = useApiClient();
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    () => loadPersistedId(STORAGE_KEYS.ACTIVE_WORKSPACE),
  );
  const [loading, setLoading] = useState(false);

  // Persist active workspace ID to localStorage
  useEffect(() => {
    persistId(STORAGE_KEYS.ACTIVE_WORKSPACE, activeWorkspaceId);
  }, [activeWorkspaceId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiClient.listWorkspaces();
      setWorkspaces(result.workspaces);

      // Auto-select first workspace if none active
      if (result.workspaces.length > 0 && !activeWorkspaceId) {
        setActiveWorkspaceId(result.workspaces[0].id);
      } else if (
        activeWorkspaceId &&
        !result.workspaces.some((w) => w.id === activeWorkspaceId)
      ) {
        // Persisted workspace ID is stale -- fall back to first available
        setActiveWorkspaceId(
          result.workspaces.length > 0 ? result.workspaces[0].id : null,
        );
      }
    } catch {
      // Server not yet available
    } finally {
      setLoading(false);
    }
  }, [apiClient, activeWorkspaceId]);

  // Fetch on mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  const open = useCallback(async (rootPath: string) => {
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
