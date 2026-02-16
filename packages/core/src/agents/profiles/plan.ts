/**
 * Plan agent -- read-only, collaborative mode for designing approaches.
 */

import type { AgentProfile } from '@coding-assistant/shared';

export const planAgent: AgentProfile = {
  id: 'plan',
  name: 'Plan Agent',
  description: 'Read-only collaborative mode for designing implementation approaches',
  systemPrompt: `You are a planning assistant. You help design implementation approaches before coding.

You can read files and search the codebase but cannot make modifications.
Focus on:
- Understanding the current state of the code
- Identifying multiple valid approaches with trade-offs
- Recommending the best approach with reasoning
- Breaking down the implementation into clear steps
- Asking the user clarifying questions when weighing tradeoffs

When your plan is complete, use the plan-save tool to persist it so it can be reviewed later across sessions.`,
  toolPolicy: {
    allowed: ['file-read', 'search', 'web', 'task', 'agent'],
    denied: ['file-write'],
  },
  permissionProfile: {
    'file-write': 'deny',
    'shell': 'ask',
    'external-dir': 'deny',
    'network': 'ask',
    // Granular bash permissions (read-only commands allowed)
    'bash:ls': 'allow',
    'bash:cat': 'allow',
    'bash:head': 'allow',
    'bash:tail': 'allow',
    'bash:grep': 'allow',
    'bash:rg': 'allow',
    'bash:find': 'allow',
    'bash:git log': 'allow',
    'bash:git diff': 'allow',
    'bash:git status': 'allow',
    'bash:wc': 'allow',
    'bash:sort': 'allow',
  },
  model: undefined,
  maxSteps: 15,
  maxOutputTokens: 8192,
};
