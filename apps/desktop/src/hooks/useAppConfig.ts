/**
 * useAppConfig -- manages model selection and effort level.
 *
 * Loads the default model from the server on startup.
 * Persists model changes back to the server optimistically.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useApiClient } from '../lib/api-client-provider';
import { DEFAULT_MODEL, DEFAULT_EFFORT } from '../constants';
import type { UseModelsReturn } from './useModels';
import type { ModelOption } from '../types';

export interface UseAppConfigReturn {
  selectedModel: string;
  selectedEffort: string;
  enabledModels: ModelOption[];
  handleModelChange: (modelId: string) => void;
  handleEffortChange: (effort: string) => void;
}

export function useAppConfig(models: UseModelsReturn): UseAppConfigReturn {
  const apiClient = useApiClient();
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
  const [selectedEffort, setSelectedEffort] = useState(DEFAULT_EFFORT);

  // Load default model from server config on startup
  useEffect(() => {
    apiClient.getDefaultModel()
      .then((res) => setSelectedModel(res.defaultModel))
      .catch(() => { /* keep fallback */ });
  }, [apiClient]);

  // Persist model changes when user selects a new model
  const handleModelChange = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    apiClient.setDefaultModel(modelId).catch(() => {
      // Non-critical: UI already updated optimistically
    });
  }, [apiClient]);

  // Derive enabled model options for the selector
  const enabledModels = useMemo<ModelOption[]>(() => {
    return models.groups
      .filter((g) => g.connected)
      .flatMap((g) =>
        g.models
          .filter((m) => m.enabled)
          .map((m) => ({
            id: m.id,
            label: m.name,
            providerId: m.providerId,
          })),
      );
  }, [models.groups]);

  return {
    selectedModel,
    selectedEffort,
    enabledModels,
    handleModelChange,
    handleEffortChange: setSelectedEffort,
  };
}
