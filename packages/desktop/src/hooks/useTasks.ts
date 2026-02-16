/**
 * useTasks -- reactive hook for session-scoped task state.
 *
 * Fetches tasks on mount and refetches when a `tasks-changed` DOM
 * CustomEvent arrives (dispatched by SSEPipe) with a newer version
 * for the matching session.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useApiClient } from '../lib/api-client-provider';
import type { TaskItem } from '../types';

export function useTasks(workspaceId: string | null, sessionId: string | null) {
  const apiClient = useApiClient();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const versionRef = useRef(0);

  const fetchTasks = useCallback(async () => {
    if (!workspaceId || !sessionId) return;
    setLoading(true);
    try {
      const res = await apiClient.getTasks(workspaceId, sessionId);
      setTasks(res.tasks);
      setVersion(res.version);
      versionRef.current = res.version;
    } catch {
      /* ignore -- tasks are non-critical */
    } finally {
      setLoading(false);
    }
  }, [workspaceId, sessionId, apiClient]);

  // Reset state when session changes
  useEffect(() => {
    setTasks([]);
    setVersion(0);
    versionRef.current = 0;
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    if (!workspaceId || !sessionId) return;
    const handler = (e: Event) => {
      const { detail } = e as CustomEvent;
      // Only refetch if this event is for our session (or our workspace+taskListId)
      const matchesSession = detail.sessionId === sessionId;
      const matchesWorkspace = detail.workspaceId === workspaceId;
      if (matchesWorkspace && matchesSession && detail.version > versionRef.current) {
        fetchTasks();
      }
    };
    window.addEventListener('tasks-changed', handler);
    return () => window.removeEventListener('tasks-changed', handler);
  }, [workspaceId, sessionId, fetchTasks]);

  return { tasks, version, loading, refetch: fetchTasks };
}
