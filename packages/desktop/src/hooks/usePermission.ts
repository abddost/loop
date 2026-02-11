/**
 * Permission dialog hook.
 */

import { useCallback } from 'react';
import { useApiClient } from '../lib/api-client-provider';

export function usePermission() {
  const apiClient = useApiClient();

  const respond = useCallback(
    async (requestId: string, granted: boolean, mode: 'once' | 'always' = 'once') => {
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
