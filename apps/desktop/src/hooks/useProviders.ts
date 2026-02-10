/**
 * useProviders -- manages the provider catalog state.
 *
 * Called at App top level so data loads on startup.
 * The Settings modal receives pre-loaded data -- no loading on open.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ApiClient, ProviderCatalogEntry } from '../lib/api-client';

export interface UseProvidersReturn {
  /** All connected providers */
  connected: ProviderCatalogEntry[];
  /** Popular providers (not connected) */
  popular: ProviderCatalogEntry[];
  /** Other providers from models.dev */
  other: ProviderCatalogEntry[];
  /** Whether the initial fetch is in progress */
  loading: boolean;
  /** Error from the last fetch */
  error: string | null;
  /** Current search query */
  search: string;
  /** Set the search query */
  setSearch: (query: string) => void;
  /** Connected providers filtered by search */
  filteredConnected: ProviderCatalogEntry[];
  /** Popular providers filtered by search */
  filteredPopular: ProviderCatalogEntry[];
  /** Other providers filtered by search */
  filteredOther: ProviderCatalogEntry[];
  /** Re-fetch provider data from the server */
  refresh: () => Promise<void>;
}

export function useProviders(apiClient: ApiClient): UseProvidersReturn {
  const [connected, setConnected] = useState<ProviderCatalogEntry[]>([]);
  const [popular, setPopular] = useState<ProviderCatalogEntry[]>([]);
  const [other, setOther] = useState<ProviderCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchProviders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.listProviders();
      setConnected(data.connected);
      setPopular(data.popular);
      setOther(data.other);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  // Fetch on mount (startup prefetch)
  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  // Client-side search filtering
  const filterBySearch = useCallback(
    (entries: ProviderCatalogEntry[]) => {
      if (!search.trim()) return entries;
      const q = search.toLowerCase();
      return entries.filter(
        (e) =>
          e.id.toLowerCase().includes(q) ||
          e.name.toLowerCase().includes(q),
      );
    },
    [search],
  );

  const filteredConnected = useMemo(
    () => filterBySearch(connected),
    [filterBySearch, connected],
  );
  const filteredPopular = useMemo(
    () => filterBySearch(popular),
    [filterBySearch, popular],
  );
  const filteredOther = useMemo(
    () => filterBySearch(other),
    [filterBySearch, other],
  );

  return {
    connected,
    popular,
    other,
    loading,
    error,
    search,
    setSearch,
    filteredConnected,
    filteredPopular,
    filteredOther,
    refresh: fetchProviders,
  };
}
