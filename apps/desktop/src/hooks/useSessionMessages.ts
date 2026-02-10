/**
 * Hook to read session messages from the EventStore.
 * Uses useSyncExternalStore for optimal React integration.
 */

import { useSyncExternalStore } from 'react';
import { useEventStore } from '../store/store-provider';
import type { SessionState } from '../store/event-store';

export function useSessionMessages(
  workspaceId: string,
  sessionId: string,
): SessionState | undefined {
  const store = useEventStore();

  return useSyncExternalStore(
    store.subscribe,
    () => store.getSession(workspaceId, sessionId),
  );
}
