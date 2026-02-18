/**
 * useLiveSessionStatuses -- merges real-time session statuses from
 * the EventStore into the API-fetched session list.
 *
 * The EventStore receives `session-status` events via SSE in real-time,
 * but the session list from `useSession` is only fetched once per
 * workspace change. This hook bridges the gap so the sidebar can
 * show live streaming indicators without a full re-fetch.
 *
 * Split into two effects:
 * 1. Sync effect — merges when sessions array identity changes (API re-fetch)
 * 2. Subscription effect — stable, uses sessionsRef + workspace-scoped subscription
 *
 * Only triggers React re-renders when a session's status actually
 * changes (not on every text-delta or other streaming event).
 */

import { useState, useEffect, useRef } from 'react';
import { useEventStore } from '../store/store-provider';
import type { SessionInfo } from '../types';

export function useLiveSessionStatuses(
  workspaceId: string | null,
  sessions: SessionInfo[],
): SessionInfo[] {
  const store = useEventStore();
  const [merged, setMerged] = useState(sessions);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  // Effect 1: Sync when sessions array identity changes (API re-fetch)
  useEffect(() => {
    if (!workspaceId || sessions.length === 0) {
      setMerged(sessions);
      return;
    }

    setMerged((prev) => {
      const next = sessions.map((s) => {
        const live = store.getSession(workspaceId, s.id);
        return live ? { ...s, status: live.status, title: live.title ?? s.title } : s;
      });
      const changed = next.some(
        (s, i) => s.status !== prev[i]?.status || s.id !== prev[i]?.id || s.title !== prev[i]?.title,
      );
      return changed ? next : prev;
    });
  }, [store, workspaceId, sessions]);

  // Effect 2: Workspace-scoped subscription — stable deps, no teardown on sessions change
  useEffect(() => {
    if (!workspaceId) return;

    const update = () => {
      const currentSessions = sessionsRef.current;
      if (currentSessions.length === 0) return;

      setMerged((prev) => {
        const next = currentSessions.map((s) => {
          const live = store.getSession(workspaceId, s.id);
          return live ? { ...s, status: live.status, title: live.title ?? s.title } : s;
        });
        const changed = next.some(
          (s, i) => s.status !== prev[i]?.status || s.id !== prev[i]?.id || s.title !== prev[i]?.title,
        );
        return changed ? next : prev;
      });
    };

    return store.subscribeWorkspace(workspaceId, update);
  }, [store, workspaceId]);

  return merged;
}
