/**
 * Agent profile validation.
 */

import { z } from 'zod';
import type { AgentProfile } from '@coding-assistant/shared';

const agentProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  systemPrompt: z.string().min(1),
  toolPolicy: z.object({
    allowed: z.array(z.string()),
    denied: z.array(z.string()),
  }),
  permissionProfile: z.record(z.enum(['allow', 'ask', 'deny'])),
  model: z.string().optional(),
  maxSteps: z.number().min(1).max(100),
  maxOutputTokens: z.number().optional(),
  temperature: z.number().min(0).max(2).optional(),
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
