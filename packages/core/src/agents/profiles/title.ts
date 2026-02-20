/**
 * Title agent -- generates session titles from conversation.
 */

import type { AgentProfile } from '@coding-assistant/shared';
import { titleAgentPrompt } from '../prompts/title';
import { Permission } from '../../permissions/permission.js';

export const titleAgent: AgentProfile = {
  id: 'title',
  name: 'Title Agent',
  description: 'Generates concise, descriptive session titles',
  systemPrompt: titleAgentPrompt,
  toolPolicy: {
    allowed: [],
    denied: ['file-read', 'file-write', 'shell', 'search', 'web', 'task', 'agent'],
  },
  permission: Permission.fromConfig({ '*': 'deny' }),
  model: undefined,
  maxSteps: 1,
  maxOutputTokens: 100,
  temperature: 0.5,
};
