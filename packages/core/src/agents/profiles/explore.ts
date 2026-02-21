/**
 * Explore agent -- fast, lightweight codebase exploration.
 */

import type { AgentProfile } from '@coding-assistant/shared';
import { exploreAgentPrompt } from '../prompts/explore';
import { Permission } from '../../permissions/permission.js';
import { defaultPermissionRules } from '../../permissions/defaults.js';

export const exploreAgent: AgentProfile = {
  id: 'explore',
  name: 'Explore Agent',
  description: 'Fast agent for exploring and understanding codebases',
  systemPrompt: exploreAgentPrompt,
  toolPolicy: {
    allowed: ['file-read', 'search', 'shell', 'web'],
    denied: ['file-write', 'task', 'agent'],
  },
  permission: Permission.merge(
    defaultPermissionRules,
    Permission.fromConfig({
      '*': 'deny',
      read: 'allow',
      grep: 'allow',
      glob: 'allow',
      bash: 'allow',
      webfetch: 'allow',
      websearch: 'allow',
    }),
  ),
  model: undefined,
  maxSteps: 10,
  maxOutputTokens: 4096,
};
