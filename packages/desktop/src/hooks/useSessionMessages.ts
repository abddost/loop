/**
 * Hook to read session messages from the EventStore.
 * Uses useSyncExternalStore with per-session scoped subscriptions
 * so components only re-render when their specific session changes
 * (not when other sessions in different tabs receive events).
 *
 * On session switch, if the EventStore has no data for the session,
 * fetches history from the server and hydrates the store.
 */

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';
import { useEventStore } from '../store/store-provider';
import { useApiClient } from '../lib/api-client-provider';
import type { SessionState } from '../store/event-store';
import type { UIMessage } from '@coding-assistant/shared';

export function useSessionMessages(
  workspaceId: string,
  sessionId: string,
): SessionState | undefined {
  const store = useEventStore();
  const apiClient = useApiClient();
  const [hydrating, setHydrating] = useState(false);

  // Hydrate from server if store is empty for this session
  useEffect(() => {
    if (!workspaceId || !sessionId) return;

    const existing = store.getSession(workspaceId, sessionId);
    if (existing && existing.messages.length > 0) return; // already have data

    setHydrating(true);
    apiClient.getSessionDetail(workspaceId, sessionId)
      .then((res) => {
        if (res.session?.messages && res.session.messages.length > 0) {
          store.hydrateSession(
            workspaceId,
            sessionId,
            res.session.messages as UIMessage[],
          );
        }
      })
      .catch(() => {
        // Session may be new with no messages -- that's fine
      })
      .finally(() => setHydrating(false));
  }, [workspaceId, sessionId, apiClient, store]);

  // Scoped subscription: only fires when this specific session changes.
  // This prevents components watching Session A from re-rendering
  // when Sessions B/C receive streaming events.
  const subscribeToSession = useCallback(
    (callback: () => void) =>
      store.subscribeSession(workspaceId, sessionId, callback),
    [store, workspaceId, sessionId],
  );

  const getSnapshot = useCallback(
    () => store.getSession(workspaceId, sessionId),
    [store, workspaceId, sessionId],
  );

  const session = useSyncExternalStore(subscribeToSession, getSnapshot);

  // Attach hydrating flag so consumers can show loading state
  if (session && hydrating) {
    return { ...session, status: 'idle' };
  }

  return session;
}
