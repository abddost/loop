/**
 * Plan agent -- read-only, collaborative mode for designing approaches.
 */

import type { AgentProfile } from '@coding-assistant/shared';
import { planAgentPrompt } from '../prompts/plan';
import { Permission } from '../../permissions/permission.js';
import { defaultPermissionRules } from '../../permissions/defaults.js';

export const planAgent: AgentProfile = {
  id: 'plan',
  name: 'Plan Agent',
  description: 'Read-only collaborative mode for designing implementation approaches',
  systemPrompt: planAgentPrompt,
  toolPolicy: {
    allowed: ['file-read', 'search', 'web', 'task', 'agent'],
    denied: ['file-write'],
  },
  permission: Permission.merge(
    defaultPermissionRules,
    Permission.fromConfig({
      edit: { '*': 'deny' },
      external_directory: { '*': 'deny' },
      webfetch: 'ask',
      websearch: 'ask',
      bash: {
        'ls *': 'allow',
        'cat *': 'allow',
        'head *': 'allow',
        'tail *': 'allow',
        'grep *': 'allow',
        'rg *': 'allow',
        'find *': 'allow',
        'git log *': 'allow',
        'git diff *': 'allow',
        'git status *': 'allow',
        'wc *': 'allow',
        'sort *': 'allow',
      },
    }),
  ),
  model: undefined,
  maxSteps: 15,
  maxOutputTokens: 8192,
};
