/**
 * Summarize agent -- compresses conversation history.
 */

import type { AgentProfile } from '@coding-assistant/shared';
import { summarizeAgentPrompt } from '../prompts/summarize';

export const summarizeAgent: AgentProfile = {
  id: 'summarize',
  name: 'Summarize Agent',
  description: 'Compresses conversation history while preserving important context',
  systemPrompt: summarizeAgentPrompt,
  toolPolicy: {
    allowed: [],
    denied: ['file-read', 'file-write', 'shell', 'search', 'web', 'task', 'agent'],
  },
  permissionProfile: {},
  model: undefined,
  maxSteps: 1,
  maxOutputTokens: 4096,
  temperature: 0.3,
};
