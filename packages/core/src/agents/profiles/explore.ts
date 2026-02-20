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
    allowed: ['file-read', 'search'],
    denied: ['file-write', 'shell', 'web', 'task', 'agent'],
  },
  permission: Permission.merge(
    defaultPermissionRules,
    Permission.fromConfig({
      '*': 'deny',
      read: 'allow',
      grep: 'allow',
      glob: 'allow',
    }),
  ),
  model: undefined,
  maxSteps: 10,
  maxOutputTokens: 4096,
};
