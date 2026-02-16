/**
 * useAgents -- fetches available agents from the backend and manages selection.
 *
 * Falls back to hardcoded defaults if the endpoint is unavailable.
 */

import { useState, useEffect, useCallback } from 'react';
import { useApiClient } from '../lib/api-client-provider';
import type { AgentInfo } from '../types';

const FALLBACK_AGENTS: AgentInfo[] = [
  {
    id: 'build',
    name: 'Build Agent',
    description: 'Implementation-focused agent with full tool access',
    capabilities: { canWrite: true, canShell: true, canWeb: true, maxSteps: 25 },
  },
  {
    id: 'plan',
    name: 'Plan Agent',
    description: 'Read-only planning and analysis agent',
    capabilities: { canWrite: false, canShell: false, canWeb: true, maxSteps: 15 },
  },
  {
    id: 'explore',
    name: 'Explore Agent',
    description: 'Codebase exploration and search agent',
    capabilities: { canWrite: false, canShell: false, canWeb: false, maxSteps: 10 },
  },
];

export function useAgents() {
  const apiClient = useApiClient();
  const [agents, setAgents] = useState<AgentInfo[]>(FALLBACK_AGENTS);
  const [selectedAgent, setSelectedAgent] = useState('build');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.listAgents()
      .then((res) => {
        if (res.agents.length > 0) {
          setAgents(res.agents);
          // Validate current selection against fetched list
          setSelectedAgent((prev) =>
            res.agents.some((a) => a.id === prev) ? prev : res.agents[0].id,
          );
        }
      })
      .catch(() => {
        // Keep fallback agents on error
      })
      .finally(() => setLoading(false));
  }, [apiClient]);

  const handleAgentChange = useCallback((agentId: string) => {
    setSelectedAgent(agentId);
  }, []);

  return {
    agents,
    selectedAgent,
    setSelectedAgent: handleAgentChange,
    loading,
  };
}
