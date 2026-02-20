/**
 * Build agent -- implementation-focused with full tool access.
 */

import type { AgentProfile } from '@coding-assistant/shared';
import { mainAgentSystemPrompt } from '../prompts/main';
import { Permission } from '../../permissions/permission.js';
import { defaultPermissionRules } from '../../permissions/defaults.js';

export const buildAgent: AgentProfile = {
  id: 'build',
  name: 'Build Agent',
  description: 'Implementation-focused agent with full tool access',
  systemPrompt: mainAgentSystemPrompt,
  toolPolicy: {
    allowed: ['file-read', 'file-write', 'shell', 'search', 'web', 'task', 'agent'],
    denied: [],
  },
  permission: Permission.merge(
    defaultPermissionRules,
    Permission.fromConfig({
      edit: 'ask',
      bash: 'ask',
      external_directory: { '*': 'ask' },
      webfetch: 'ask',
      websearch: 'ask',
    }),
  ),
  model: undefined,
  maxSteps: 25,
  maxOutputTokens: 16384,
};
