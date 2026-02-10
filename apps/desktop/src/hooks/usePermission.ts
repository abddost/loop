/**
 * Permission dialog hook.
 */

import { useCallback } from 'react';
import type { ApiClient } from '../lib/api-client';

export function usePermission(apiClient: ApiClient | null) {
  const respond = useCallback(
    async (requestId: string, granted: boolean, mode: 'once' | 'always' = 'once') => {
      if (!apiClient) return;
      try {
        await apiClient.respondToPermission(requestId, granted, mode);
      } catch (err) {
        console.error('Failed to respond to permission:', err);
      }
    },
    [apiClient],
  );

  return { respond };
}
