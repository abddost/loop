/**
 * React context providing the ApiClient.
 *
 * Eliminates apiClient prop drilling through 7+ components.
 * Created once in App.tsx and consumed via useApiClient() anywhere.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { ApiClient } from './api-client';

const ApiClientContext = createContext<ApiClient | null>(null);

interface ApiClientProviderProps {
  baseUrl: string;
  authToken: string;
  children: ReactNode;
}

export function ApiClientProvider({
  baseUrl,
  authToken,
  children,
}: ApiClientProviderProps) {
  const client = useMemo(
    () => new ApiClient(baseUrl, authToken),
    [baseUrl, authToken],
  );

  return (
    <ApiClientContext.Provider value={client}>
      {children}
    </ApiClientContext.Provider>
  );
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) {
    throw new Error('useApiClient must be used within an ApiClientProvider');
  }
  return client;
}
