/**
 * Hook to read session messages from the EventStore.
 * Uses useSyncExternalStore for optimal React integration.
 *
 * On session switch, if the EventStore has no data for the session,
 * fetches history from the server and hydrates the store.
 */

import { useState, useEffect, useSyncExternalStore } from 'react';
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

  const session = useSyncExternalStore(
    store.subscribe,
    () => store.getSession(workspaceId, sessionId),
  );

  // Attach hydrating flag so consumers can show loading state
  if (session && hydrating) {
    return { ...session, status: 'idle' };
  }

  return session;
}
