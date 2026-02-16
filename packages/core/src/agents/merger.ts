/**
 * Agent system prompt construction.
 * Merges agent base prompt with workspace instructions.
 */

import type { AgentProfile } from '@coding-assistant/shared';

/**
 * Build the full system prompt for an agent execution.
 */
export function buildSystemPrompt(
  agent: AgentProfile,
  workspaceInstructions: string[],
): string {
  const parts: string[] = [agent.systemPrompt];

  for (const instruction of workspaceInstructions) {
    parts.push(`<agent_instructions>\n${instruction}\n</agent_instructions>`);
  }

  return parts.join('\n\n');
}

