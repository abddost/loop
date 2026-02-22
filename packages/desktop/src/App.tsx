/**
 * Main App component -- slim orchestrator.
 *
 * Wires up context providers and delegates all state logic to hooks.
 * Renders the Cursor-like layout: sidebar + main content area.
 */

import { useMemo, useEffect, useState } from 'react';
import { EventStore } from './store/event-store';
import { EventStoreProvider } from './store/store-provider';
import { ApiClientProvider } from './lib/api-client-provider';
import { SSEPipe } from './lib/sse-pipe';
import { DEFAULT_SERVER_URL, DEFAULT_AUTH_TOKEN } from './constants';
import { AppLayout } from './AppLayout';

export default function App() {
  const [serverUrl] = useState(DEFAULT_SERVER_URL);
  const [authToken] = useState(DEFAULT_AUTH_TOKEN);

  // Core singletons
  const store = useMemo(() => new EventStore(), []);
  const pipe = useMemo(() => new SSEPipe(store), [store]);

  // SSE connection lifecycle
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // On SSE reconnect, broadcast a custom event so active hooks
    // (useSessionMessages) know to rehydrate from the REST API.
    pipe.onReconnect = () => {
      window.dispatchEvent(new CustomEvent('sse-reconnected'));
    };

    pipe.connect(serverUrl, authToken);
    setConnected(true);
    return () => {
      pipe.disconnect();
      setConnected(false);
    };
  }, [pipe, serverUrl, authToken]);

  return (
    <ApiClientProvider baseUrl={serverUrl} authToken={authToken}>
      <EventStoreProvider store={store}>
        <AppLayout connected={connected} />
      </EventStoreProvider>
    </ApiClientProvider>
  );
}
