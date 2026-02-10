/**
 * subagent tool -- spawns a sub-agent for focused tasks.
 */

import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  task: z.string().describe('The task description for the sub-agent'),
  agentId: z.string().optional().default('build').describe('Which agent profile to use'),
  context: z.string().optional().describe('Additional context for the sub-agent'),
});

type Input = z.infer<typeof inputSchema>;

export const definition: ToolDefinition<Input, string> = {
  name: 'subagent',
  description: 'Spawn a sub-agent to handle a focused task autonomously',
  inputSchema,
  category: 'agent',
  riskLevel: 'moderate',

  async execute(input, _ctx) {
    // Placeholder -- full implementation requires agent system integration
    return {
      result: `Sub-agent task queued: ${input.task} (agent: ${input.agentId})`,
      metadata: {
        agentId: input.agentId,
        task: input.task,
      },
    };
  },
};
