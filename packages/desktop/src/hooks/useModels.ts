/**
 * useModels -- manages the grouped model list state.
 *
 * Called at App top level so data loads on startup.
 * The Settings modal receives pre-loaded data -- no loading on open.
 *
 * Features:
 * - Client-side priority sorting (flagship models bubble to the top)
 * - Search filtering across model name, ID, and provider name
 * - Optimistic toggle with automatic revert on failure
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useApiClient } from '../lib/api-client-provider';
import type { ModelEntry, ModelGroup } from '../types';

export type { ModelEntry, ModelGroup };

// ── Client-side model priority sorting ──────────────────────────────────
//
// Mirrors the server-side sort as a fallback / enhancement.  Substring-based
// priority: flagship model families appear first, "latest" variants are
// boosted within the same tier, then alphabetical.

const MODEL_PRIORITY = ['gpt-5', 'claude-sonnet-4', 'big-pickle', 'gemini-3-pro'];

function sortModelsByPriority(models: ModelEntry[]): ModelEntry[] {
  return [...models].sort((a, b) => {
    const aPri = MODEL_PRIORITY.findIndex((p) => a.id.includes(p));
    const bPri = MODEL_PRIORITY.findIndex((p) => b.id.includes(p));

    if (aPri !== bPri) {
      if (aPri === -1) return 1;
      if (bPri === -1) return -1;
      return aPri - bPri;
    }

    const aLatest = a.id.includes('latest') ? 0 : 1;
    const bLatest = b.id.includes('latest') ? 0 : 1;
    if (aLatest !== bLatest) return aLatest - bLatest;

    return a.name.localeCompare(b.name);
  });
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
  /** Groups filtered by search (models also sorted by priority) */
  filteredGroups: ModelGroup[];
  /** Toggle a model's enabled state */
  toggleModel: (modelId: string, enabled: boolean) => Promise<void>;
  /** Re-fetch model data from the server */
  refresh: () => Promise<void>;
}

export function useModels(): UseModelsReturn {
  const apiClient = useApiClient();
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchModels = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.listModelsGrouped();

      // Apply client-side priority sort on top of the server-sorted data.
      // This ensures a consistent order even if the server didn't sort
      // (e.g. stale cached response).
      const sorted = data.groups.map((g: ModelGroup) => ({
        ...g,
        models: sortModelsByPriority(g.models),
      }));

      setGroups(sorted);
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
