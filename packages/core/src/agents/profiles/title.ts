/**
 * Title agent -- generates session titles from conversation.
 */

import type { AgentProfile } from '@coding-assistant/shared';
import { titleAgentPrompt } from '../prompts/title';

export const titleAgent: AgentProfile = {
  id: 'title',
  name: 'Title Agent',
  description: 'Generates concise, descriptive session titles',
  systemPrompt: titleAgentPrompt,
  toolPolicy: {
    allowed: [],
    denied: ['file-read', 'file-write', 'shell', 'search', 'web', 'task', 'agent'],
  },
  permissionProfile: {},
  model: undefined,
  maxSteps: 1,
  maxOutputTokens: 100,
  temperature: 0.5,
};
