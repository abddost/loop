/**
 * Hook to read session messages from the EventStore.
 * Uses useSyncExternalStore with per-session scoped subscriptions
 * so components only re-render when their specific session changes
 * (not when other sessions in different tabs receive events).
 *
 * On session switch, if the EventStore has no data for the session,
 * fetches history from the server and hydrates the store.
 * Uses pagination: loads only the most recent INITIAL_PAGE_SIZE messages,
 * with support for loading older messages on demand.
 *
 * On SSE reconnect, rehydrates the active session from the API
 * to ensure consistency (events missed during disconnect are ignored;
 * the database is the source of truth).
 */

import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { useEventStore } from '../store/store-provider';
import { useApiClient } from '../lib/api-client-provider';
import type { SessionState } from '../store/event-store';
import type { UIMessage } from '@coding-assistant/shared';

const INITIAL_PAGE_SIZE = 50;

interface PaginationInfo {
  total: number;
  loaded: number;
  oldestLoadedOffset: number;
}

export function useSessionMessages(
  workspaceId: string,
  sessionId: string,
): SessionState | undefined {
  const store = useEventStore();
  const apiClient = useApiClient();
  const [hydrating, setHydrating] = useState(false);
  const paginationRef = useRef<PaginationInfo | null>(null);
  const loadingMoreRef = useRef(false);

  const hydrateFromServer = useCallback(() => {
    if (!workspaceId || !sessionId) return;

    setHydrating(true);

    // Request with pagination to get total count + first page
    apiClient.getSessionDetail(workspaceId, sessionId, { limit: INITIAL_PAGE_SIZE, offset: 0 })
      .then((res) => {
        const pagination = res.pagination;
        if (pagination && pagination.total > INITIAL_PAGE_SIZE) {
          // Load the LAST page (most recent messages)
          const lastPageOffset = Math.max(0, pagination.total - INITIAL_PAGE_SIZE);
          return apiClient.getSessionDetail(workspaceId, sessionId, {
            limit: INITIAL_PAGE_SIZE,
            offset: lastPageOffset,
          });
        }
        return res; // <= INITIAL_PAGE_SIZE messages, already have them all
      })
      .then((res) => {
        if (res.session?.messages && res.session.messages.length > 0) {
          store.hydrateSession(
            workspaceId,
            sessionId,
            res.session.messages as UIMessage[],
          );
          if (res.pagination) {
            paginationRef.current = {
              total: res.pagination.total,
              loaded: res.session.messages.length,
              oldestLoadedOffset: res.pagination.offset,
            };
          }
        }
      })
      .catch(() => {})
      .finally(() => setHydrating(false));
  }, [workspaceId, sessionId, apiClient, store]);

  // Load older messages (for "load more" on scroll-up)
  const loadMore = useCallback(() => {
    if (!workspaceId || !sessionId || loadingMoreRef.current) return;
    const info = paginationRef.current;
    if (!info || info.oldestLoadedOffset <= 0) return;

    loadingMoreRef.current = true;
    const nextOffset = Math.max(0, info.oldestLoadedOffset - INITIAL_PAGE_SIZE);
    const nextLimit = info.oldestLoadedOffset - nextOffset;

    apiClient.getSessionDetail(workspaceId, sessionId, { limit: nextLimit, offset: nextOffset })
      .then((res) => {
        if (res.session?.messages && res.session.messages.length > 0) {
          store.prependMessages(
            workspaceId,
            sessionId,
            res.session.messages as UIMessage[],
          );
          paginationRef.current = {
            total: info.total,
            loaded: info.loaded + res.session.messages.length,
            oldestLoadedOffset: nextOffset,
          };
        }
      })
      .catch(() => {})
      .finally(() => { loadingMoreRef.current = false; });
  }, [workspaceId, sessionId, apiClient, store]);

  // Hydrate from server if store is empty for this session
  useEffect(() => {
    if (!workspaceId || !sessionId) return;

    const existing = store.getSession(workspaceId, sessionId);
    if (existing && existing.messages.length > 0) return;

    hydrateFromServer();
  }, [workspaceId, sessionId, store, hydrateFromServer]);

  // Rehydrate on SSE reconnect to recover from any missed events
  useEffect(() => {
    if (!workspaceId || !sessionId) return;

    const handler = () => hydrateFromServer();
    window.addEventListener('sse-reconnected', handler);
    return () => window.removeEventListener('sse-reconnected', handler);
  }, [workspaceId, sessionId, hydrateFromServer]);

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

  if (session && hydrating) {
    return { ...session, status: 'idle' };
  }

  return session;
}
