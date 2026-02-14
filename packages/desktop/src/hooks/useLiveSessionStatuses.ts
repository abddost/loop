/**
 * useLiveSessionStatuses -- merges real-time session statuses from
 * the EventStore into the API-fetched session list.
 *
 * The EventStore receives `session-status` events via SSE in real-time,
 * but the session list from `useSession` is only fetched once per
 * workspace change. This hook bridges the gap so the sidebar can
 * show live streaming indicators without a full re-fetch.
 *
 * Only triggers React re-renders when a session's status actually
 * changes (not on every text-delta or other streaming event).
 */

import { useState, useEffect } from 'react';
import { useEventStore } from '../store/store-provider';
import type { SessionInfo } from '../types';

export function useLiveSessionStatuses(
  workspaceId: string | null,
  sessions: SessionInfo[],
): SessionInfo[] {
  const store = useEventStore();
  const [merged, setMerged] = useState(sessions);

  useEffect(() => {
    if (!workspaceId || sessions.length === 0) {
      setMerged(sessions);
      return;
    }

    const update = () => {
      setMerged((prev) => {
        const next = sessions.map((s) => {
          const live = store.getSession(workspaceId, s.id);
          return live ? { ...s, status: live.status, title: live.title ?? s.title } : s;
        });
        // Only create a new array when statuses actually differ
        const changed = next.some(
          (s, i) => s.status !== prev[i]?.status || s.id !== prev[i]?.id || s.title !== prev[i]?.title,
        );
        return changed ? next : prev;
      });
    };

    update();
    return store.subscribe(update);
  }, [store, workspaceId, sessions]);

  return merged;
}
