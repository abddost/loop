/**
 * Plan agent -- read-only, collaborative mode for designing approaches.
 */

import type { AgentProfile } from '@coding-assistant/shared';

export const planAgent: AgentProfile = {
  id: 'plan',
  name: 'Plan Agent',
  description: 'Read-only collaborative mode for designing implementation approaches',
  systemPrompt: `You are a planning assistant. You help design implementation approaches before coding.

You can read files and search the codebase but cannot make modifications.
Focus on:
- Understanding the current state of the code
- Identifying multiple valid approaches with trade-offs
- Recommending the best approach with reasoning
- Breaking down the implementation into clear steps`,
  toolPolicy: {
    allowed: ['file-read', 'search', 'web', 'task'],
    denied: ['file-write', 'shell'],
  },
  permissionProfile: {
    'file-write': 'deny',
    'shell': 'deny',
    'external-dir': 'deny',
    'network': 'ask',
  },
  model: undefined,
  maxSteps: 15,
  maxOutputTokens: 8192,
};
