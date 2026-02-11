/**
 * Build agent -- implementation-focused with full tool access.
 */

import type { AgentProfile } from '@coding-assistant/shared';

export const buildAgent: AgentProfile = {
  id: 'build',
  name: 'Build Agent',
  description: 'Implementation-focused agent with full tool access',
  systemPrompt: `You are a coding assistant. You help users with software engineering tasks.

You have access to tools for reading, writing, and editing files, executing shell commands, searching the web, and managing tasks.

Follow these principles:
- Read files before editing them
- Make targeted edits rather than rewriting entire files
- Explain what you're doing and why
- Check for errors after making changes
- Prefer editing existing files to creating new ones`,
  toolPolicy: {
    allowed: ['file-read', 'file-write', 'shell', 'search', 'web', 'task'],
    denied: [],
  },
  permissionProfile: {
    'file-write': 'ask',
    'shell': 'ask',
    'external-dir': 'deny',
    'network': 'ask',
  },
  model: undefined,
  maxSteps: 25,
  maxOutputTokens: 16384,
};
