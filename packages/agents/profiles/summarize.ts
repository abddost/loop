/**
 * Summarize agent -- compresses conversation history.
 */

import type { AgentProfile } from '@coding-assistant/shared';

export const summarizeAgent: AgentProfile = {
  id: 'summarize',
  name: 'Summarize Agent',
  description: 'Compresses conversation history while preserving important context',
  systemPrompt: `You are a summarization agent. Your job is to compress conversation history into a concise summary while preserving:

1. Key decisions and their reasoning
2. Important code changes and file modifications
3. Active todos and pending tasks
4. Recent context that is still relevant

Be concise but complete. The summary will replace the original messages in the context window.`,
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
