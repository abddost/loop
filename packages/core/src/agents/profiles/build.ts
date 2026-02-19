/**
 * Build agent -- implementation-focused with full tool access.
 */

import type { AgentProfile } from '@coding-assistant/shared';
import { mainAgentSystemPrompt } from '../prompts/main';

export const buildAgent: AgentProfile = {
  id: 'build',
  name: 'Build Agent',
  description: 'Implementation-focused agent with full tool access',
  systemPrompt: mainAgentSystemPrompt,
  toolPolicy: {
    allowed: ['file-read', 'file-write', 'shell', 'search', 'web', 'task', 'agent'],
    denied: [],
  },
  permissionProfile: {
    'file-write': 'allow',
    'shell': 'allow',
    'external-dir': 'ask',
    'network': 'ask',
  },
  model: undefined,
  maxSteps: 25,
  maxOutputTokens: 16384,
};
