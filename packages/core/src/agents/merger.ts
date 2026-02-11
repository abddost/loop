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

/**
 * Prepare step hook for multi-step execution.
 * Can modify tools, system prompt, etc. between steps.
 */
export function prepareStep(
  agent: AgentProfile,
  _context: { workspaceId: string; sessionId: string },
  _previousSteps: unknown[],
  stepNumber: number,
): { tools?: string[]; addToSystem?: string } | undefined {
  // After a certain number of steps, add a reminder
  if (stepNumber > agent.maxSteps * 0.75) {
    return {
      addToSystem: `You are approaching the step limit (${stepNumber}/${agent.maxSteps}). Please wrap up your current task.`,
    };
  }

  return undefined;
}
