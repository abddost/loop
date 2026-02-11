/**
 * useSession -- manages session list and active session for a workspace.
 *
 * Validates persisted session ID against server state on workspace change.
 * Provides create/delete operations.
 */

import { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '../lib/api-client-provider';
import { STORAGE_KEYS } from '../constants';
import type { SessionInfo } from '../types';

function loadPersistedId(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function persistId(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* ignore storage errors */ }
}

export function useSession(activeWorkspaceId: string | null) {
  const apiClient = useApiClient();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    () => loadPersistedId(STORAGE_KEYS.ACTIVE_SESSION),
  );

  // Persist active session ID to localStorage
  useEffect(() => {
    persistId(STORAGE_KEYS.ACTIVE_SESSION, activeSessionId);
  }, [activeSessionId]);

  // Load sessions when workspace changes -- validate persisted session ID
  useEffect(() => {
    if (!activeWorkspaceId) {
      setSessions([]);
      return;
    }

    apiClient.listSessions(activeWorkspaceId).then((result) => {
      setSessions(result.sessions);
      if (result.sessions.length > 0 && !activeSessionId) {
        setActiveSessionId(result.sessions[0].id);
      } else if (
        activeSessionId &&
        !result.sessions.some((s) => s.id === activeSessionId)
      ) {
        // Persisted session ID is stale -- fall back to first available
        setActiveSessionId(
          result.sessions.length > 0 ? result.sessions[0].id : null,
        );
      }
    }).catch(() => {
      setSessions([]);
    });
  }, [apiClient, activeWorkspaceId, activeSessionId]);

  const createSession = useCallback(async () => {
    if (!activeWorkspaceId) return;
    try {
      const result = await apiClient.createSession(activeWorkspaceId);
      setActiveSessionId(result.session.id);
      const updated = await apiClient.listSessions(activeWorkspaceId);
      setSessions(updated.sessions);
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  }, [apiClient, activeWorkspaceId]);

  // Derive active session info
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    activeSession,
    createSession,
  };
}
