/**
 * React context providing the EventStore.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { EventStore } from './event-store';

const EventStoreContext = createContext<EventStore | null>(null);

export function EventStoreProvider({
  store,
  children,
}: {
  store: EventStore;
  children: ReactNode;
}) {
  return (
    <EventStoreContext.Provider value={store}>
      {children}
    </EventStoreContext.Provider>
  );
}

export function useEventStore(): EventStore {
  const store = useContext(EventStoreContext);
  if (!store) {
    throw new Error('useEventStore must be used within an EventStoreProvider');
  }
  return store;
}
