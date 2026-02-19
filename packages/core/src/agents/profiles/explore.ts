/**
 * Explore agent -- fast, lightweight codebase exploration.
 */

import type { AgentProfile } from '@coding-assistant/shared';
import { exploreAgentPrompt } from '../prompts/explore';

export const exploreAgent: AgentProfile = {
  id: 'explore',
  name: 'Explore Agent',
  description: 'Fast agent for exploring and understanding codebases',
  systemPrompt: exploreAgentPrompt,
  toolPolicy: {
    allowed: ['file-read', 'search'],
    denied: ['file-write', 'shell', 'web', 'task', 'agent'],
  },
  permissionProfile: {
    'file-write': 'deny',
    'shell': 'deny',
    'external-dir': 'deny',
    'network': 'deny',
  },
  model: undefined,
  maxSteps: 10,
  maxOutputTokens: 4096,
};
