/**
 * Title agent -- generates session titles from conversation.
 */

import type { AgentProfile } from '@coding-assistant/shared';

export const titleAgent: AgentProfile = {
  id: 'title',
  name: 'Title Agent',
  description: 'Generates concise, descriptive session titles',
  systemPrompt: `Generate a concise title (4-8 words) for this conversation. The title should describe the main task or topic. Return only the title text, nothing else.`,
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
