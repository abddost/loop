/**
 * Plan agent -- read-only, collaborative mode for designing approaches.
 */

import type { AgentProfile } from '@coding-assistant/shared';
import { planAgentPrompt } from '../prompts/plan';

export const planAgent: AgentProfile = {
  id: 'plan',
  name: 'Plan Agent',
  description: 'Read-only collaborative mode for designing implementation approaches',
  systemPrompt: planAgentPrompt,
  toolPolicy: {
    allowed: ['file-read', 'search', 'web', 'task', 'agent'],
    denied: ['file-write'],
  },
  permissionProfile: {
    'file-write': 'deny',
    'shell': 'ask',
    'external-dir': 'deny',
    'network': 'ask',
    '*': 'allow',
    '**': 'allow',
    // Granular bash permissions (read-only commands allowed)
    'bash:ls': 'allow',
    'bash:cat': 'allow',
    'bash:head': 'allow',
    'bash:tail': 'allow',
    'bash:grep': 'allow',
    'bash:rg': 'allow',
    'bash:find': 'allow',
    'bash:git log': 'allow',
    'bash:git diff': 'allow',
    'bash:git status': 'allow',
    'bash:wc': 'allow',
    'bash:sort': 'allow',
  },
  model: undefined,
  maxSteps: 15,
  maxOutputTokens: 8192,
};
