/**
 * useWorkspace -- manages workspace list, active workspace, and persistence.
 *
 * Validates persisted workspace ID against server state on mount.
 * Provides open/close/refresh operations.
 *
 * Uses a ref for activeWorkspaceId to break the dependency loop where:
 * refresh depends on activeWorkspaceId -> effect depends on refresh ->
 * setActiveWorkspaceId inside refresh recreates refresh -> effect re-triggers.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
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

  // Ref to read current activeWorkspaceId inside callbacks without
  // adding it as a dependency (breaks the refresh -> effect loop).
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  activeWorkspaceIdRef.current = activeWorkspaceId;

  // Persist active workspace ID to localStorage
  useEffect(() => {
    persistId(STORAGE_KEYS.ACTIVE_WORKSPACE, activeWorkspaceId);
  }, [activeWorkspaceId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiClient.listWorkspaces();
      setWorkspaces(result.workspaces);

      const currentId = activeWorkspaceIdRef.current;
      // Auto-select first workspace if none active
      if (result.workspaces.length > 0 && !currentId) {
        setActiveWorkspaceId(result.workspaces[0].id);
      } else if (
        currentId &&
        !result.workspaces.some((w) => w.id === currentId)
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
  }, [apiClient]); // activeWorkspaceId removed -- read via ref

  // Fetch on mount (refresh is now stable -- only changes when apiClient changes)
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh on window focus — picks up branch changes when user switches branches in terminal
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
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
      if (activeWorkspaceIdRef.current === id) {
        setActiveWorkspaceId(null);
      }
      await refresh();
    } catch (err) {
      console.error('Failed to close workspace:', err);
    }
  }, [apiClient, refresh]); // activeWorkspaceId removed -- read via ref

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
