/**
 * useSession -- manages session list and active session for a workspace.
 *
 * Validates persisted session ID against server state on workspace change.
 * Provides create/delete operations.
 *
 * Uses a ref for activeSessionId in the fetch effect to avoid a
 * dependency loop (the effect was re-triggering itself when it called
 * setActiveSessionId, causing double-fetches on every workspace change).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
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

  // Ref to read current activeSessionId inside effects without adding it as a dependency
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  // Persist active session ID to localStorage
  useEffect(() => {
    persistId(STORAGE_KEYS.ACTIVE_SESSION, activeSessionId);
  }, [activeSessionId]);

  // Load sessions when workspace changes -- validate persisted session ID.
  // Uses activeSessionIdRef to avoid the dependency loop where
  // setActiveSessionId -> activeSessionId change -> effect re-triggers.
  useEffect(() => {
    if (!activeWorkspaceId) {
      setSessions([]);
      return;
    }

    apiClient.listSessions(activeWorkspaceId).then((result) => {
      setSessions(result.sessions);
      const currentId = activeSessionIdRef.current;
      if (result.sessions.length > 0 && !currentId) {
        setActiveSessionId(result.sessions[0].id);
      } else if (
        currentId &&
        !result.sessions.some((s) => s.id === currentId)
      ) {
        // Persisted session ID is stale -- fall back to first available
        setActiveSessionId(
          result.sessions.length > 0 ? result.sessions[0].id : null,
        );
      }
    }).catch(() => {
      setSessions([]);
    });
  }, [apiClient, activeWorkspaceId]); // activeSessionId removed -- read via ref

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

  const deleteSession = useCallback(async (sessionId: string) => {
    if (!activeWorkspaceId) return;
    try {
      await apiClient.deleteSession(activeWorkspaceId, sessionId);
      // If the deleted session was active, clear or pick next
      if (activeSessionIdRef.current === sessionId) {
        const remaining = sessions.filter((s) => s.id !== sessionId);
        setActiveSessionId(remaining.length > 0 ? remaining[0].id : null);
      }
      const updated = await apiClient.listSessions(activeWorkspaceId);
      setSessions(updated.sessions);
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  }, [apiClient, activeWorkspaceId, sessions]);

  // Refresh session list from server (picks up new titles after execution)
  const refreshSessions = useCallback(async () => {
    if (!activeWorkspaceId) return;
    try {
      const result = await apiClient.listSessions(activeWorkspaceId);
      setSessions(result.sessions);
    } catch {
      // Silently ignore refresh failures
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
    deleteSession,
    refreshSessions,
  };
}
