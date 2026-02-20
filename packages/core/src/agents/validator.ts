/**
 * Agent profile validation.
 */

import { z } from 'zod';
import type { AgentProfile } from '@coding-assistant/shared';

const permissionRuleSchema = z.object({
  permission: z.string(),
  pattern: z.string(),
  action: z.enum(['allow', 'deny', 'ask']),
});

const agentProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  systemPrompt: z.string().min(1),
  toolPolicy: z.object({
    allowed: z.array(z.string()),
    denied: z.array(z.string()),
  }),
  permission: z.array(permissionRuleSchema),
  model: z.string().optional(),
  maxSteps: z.number().min(1).max(100),
  maxOutputTokens: z.number().optional(),
  temperature: z.number().min(0).max(2).optional(),
  // Legacy field — ignored during validation
  permissionProfile: z.record(z.enum(['allow', 'ask', 'deny'])).optional(),
});

export function validateAgentProfile(profile: unknown): {
  valid: boolean;
  errors?: string[];
} {
  const result = agentProfileSchema.safeParse(profile);

  if (result.success) {
    return { valid: true };
  }

  return {
    valid: false,
    errors: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
  };
}

export function isValidAgentProfile(profile: unknown): profile is AgentProfile {
  return agentProfileSchema.safeParse(profile).success;
}
