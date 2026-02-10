/**
 * Explore agent -- fast, lightweight codebase exploration.
 */

import type { AgentProfile } from '@coding-assistant/shared';

export const exploreAgent: AgentProfile = {
  id: 'explore',
  name: 'Explore Agent',
  description: 'Fast agent for exploring and understanding codebases',
  systemPrompt: `You are a codebase exploration assistant. Your job is to quickly find relevant files, understand code structure, and answer questions about the codebase.

Be concise and direct. Return specific file paths and code references. Do not modify any files.`,
  toolPolicy: {
    allowed: ['file-read', 'search'],
    denied: ['file-write', 'shell', 'web', 'task', 'agent'],
  },
  permissionProfile: {
    'file-write': 'deny',
    'shell': 'deny',
    'external-dir': 'deny',
    'network': 'deny',
  },
  model: undefined,
  maxSteps: 10,
  maxOutputTokens: 4096,
};
