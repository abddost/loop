/**
 * Universal agent -- full-capability subagent for multi-step tasks.
 *
 * Has access to write, edit, bash, search -- everything except spawning
 * further subagents. Can only be spawned by the primary build agent.
 */

import type { AgentProfile } from '@coding-assistant/shared';
import { universalAgentPrompt } from '../prompts/universal';

export const universalAgent: AgentProfile = {
  id: 'universal',
  name: 'Universal Agent',
  description: 'Full-capability subagent for multi-step tasks (write, edit, bash, search)',
  systemPrompt: universalAgentPrompt,
  toolPolicy: {
    allowed: ['file-read', 'file-write', 'shell', 'search', 'web', 'task'],
    denied: ['agent'],
  },
  permissionProfile: {
    'file-write': 'allow',
    'shell': 'allow',
    'external-dir': 'deny',
    'network': 'ask',
  },
  model: undefined,
  maxSteps: 25,
  maxOutputTokens: 16384,
};
