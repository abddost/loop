/**
 * Universal agent -- full-capability subagent for multi-step tasks.
 *
 * Has access to write, edit, bash, search -- everything except spawning
 * further subagents. Can only be spawned by the primary build agent.
 */

import type { AgentProfile } from '@coding-assistant/shared';
import { universalAgentPrompt } from '../prompts/universal';
import { Permission } from '../../permissions/permission.js';
import { defaultPermissionRules } from '../../permissions/defaults.js';

export const universalAgent: AgentProfile = {
  id: 'universal',
  name: 'Universal Agent',
  description: 'Full-capability subagent for multi-step tasks (write, edit, bash, search)',
  systemPrompt: universalAgentPrompt,
  toolPolicy: {
    allowed: ['file-read', 'file-write', 'shell', 'search', 'web', 'task'],
    denied: ['agent'],
  },
  permission: Permission.merge(
    defaultPermissionRules,
    Permission.fromConfig({
      edit: 'allow',
      bash: 'allow',
      external_directory: { '*': 'deny' },
      webfetch: 'ask',
      websearch: 'ask',
    }),
  ),
  model: undefined,
  maxSteps: 25,
  maxOutputTokens: 16384,
};
