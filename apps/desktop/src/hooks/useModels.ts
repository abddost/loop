/**
 * useModels -- manages the grouped model list state.
 *
 * Called at App top level so data loads on startup.
 * The Settings modal receives pre-loaded data -- no loading on open.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ApiClient } from '../lib/api-client';

export interface ModelEntry {
  id: string;
  providerId: string;
  name: string;
  description: string;
  enabled: boolean;
  limits: { context: number; maxOutput: number };
  capabilities: {
    streaming: boolean;
    functionCalling: boolean;
    vision: boolean;
    reasoning: boolean;
    json: boolean;
  };
}

export interface ModelGroup {
  provider: {
    id: string;
    name: string;
    description: string;
    website: string;
  };
  connected: boolean;
  models: ModelEntry[];
}

export interface UseModelsReturn {
  /** Model groups (sorted: connected first, then alphabetical) */
  groups: ModelGroup[];
  /** Whether the initial fetch is in progress */
  loading: boolean;
  /** Error from the last fetch */
  error: string | null;
  /** Current search query */
  search: string;
  /** Set the search query */
  setSearch: (query: string) => void;
  /** Groups filtered by search */
  filteredGroups: ModelGroup[];
  /** Toggle a model's enabled state */
  toggleModel: (modelId: string, enabled: boolean) => Promise<void>;
  /** Re-fetch model data from the server */
  refresh: () => Promise<void>;
}

export function useModels(apiClient: ApiClient): UseModelsReturn {
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchModels = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.listModelsGrouped();
      setGroups(data.groups);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load models');
    } finally {
      setLoading(false);
    }
  }, [apiClient]);

  // Fetch on mount (startup prefetch)
  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Client-side search filtering
  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();

    return groups
      .map((group) => ({
        ...group,
        models: group.models.filter(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            m.id.toLowerCase().includes(q) ||
            group.provider.name.toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.models.length > 0);
  }, [search, groups]);

  const toggleModel = useCallback(
    async (modelId: string, enabled: boolean) => {
      // Optimistic update
      setGroups((prev) =>
        prev.map((g) => ({
          ...g,
          models: g.models.map((m) =>
            m.id === modelId ? { ...m, enabled } : m,
          ),
        })),
      );

      try {
        await apiClient.toggleModel(modelId, enabled);
      } catch {
        // Revert on failure
        setGroups((prev) =>
          prev.map((g) => ({
            ...g,
            models: g.models.map((m) =>
              m.id === modelId ? { ...m, enabled: !enabled } : m,
            ),
          })),
        );
      }
    },
    [apiClient],
  );

  return {
    groups,
    loading,
    error,
    search,
    setSearch,
    filteredGroups,
    toggleModel,
    refresh: fetchModels,
  };
}
