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
    allowed: ['file-read', 'search', 'shell', 'web', 'task', 'agent'],
    denied: ['file-write'],
  },
  permission: Permission.merge(
    defaultPermissionRules,
    Permission.fromConfig({
      edit: {
        '*': 'deny',
        '.coding-assistant/plans/*.md': 'allow',
      },
    }),
  ),
  model: undefined,
  maxSteps: 15,
  maxOutputTokens: 8192,
};
