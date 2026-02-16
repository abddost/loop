/**
 * Summarize agent -- compresses conversation history.
 */

import type { AgentProfile } from '@coding-assistant/shared';

export const summarizeAgent: AgentProfile = {
  id: 'summarize',
  name: 'Summarize Agent',
  description: 'Compresses conversation history while preserving important context',
  systemPrompt: `You are a helpful AI assistant tasked with summarizing conversations.

When asked to summarize, provide a detailed but concise summary of the conversation.
Focus on information that would be helpful for continuing the conversation, including:
- What was done
- What is currently being worked on
- Which files are being modified
- What needs to be done next
- Key user requests, constraints, or preferences that should persist
- Important technical decisions and why they were made

Your summary should be comprehensive enough to provide context but concise enough to be quickly understood.`,
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
