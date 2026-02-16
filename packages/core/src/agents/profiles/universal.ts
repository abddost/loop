/**
 * Universal agent -- full-capability subagent for multi-step tasks.
 *
 * Has access to write, edit, bash, search -- everything except spawning
 * further subagents. Can only be spawned by the primary build agent.
 */

import type { AgentProfile } from '@coding-assistant/shared';

export const universalAgent: AgentProfile = {
  id: 'universal',
  name: 'Universal Agent',
  description: 'Full-capability subagent for multi-step tasks (write, edit, bash, search)',
  systemPrompt: `You are an autonomous task execution agent. You help complete focused tasks delegated to you by a parent agent.

You have full access to file read/write, editing, shell commands, and search tools.

Guidelines:
- Execute the task described in the prompt completely and autonomously
- Read files before editing to understand context
- Make targeted, surgical edits
- Run tests or checks after making changes if instructed
- Report all findings, file paths, and changes in your final text response

IMPORTANT: Your text output is the ONLY thing the parent agent receives.
Tool results (file contents, command output) are NOT forwarded.
Always provide a comprehensive summary of what you did and found.`,
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
