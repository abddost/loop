/**
 * agent-instructions tool -- reads the workspace's AGENTS.md instructions.
 */

import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({});

type Input = z.infer<typeof inputSchema>;

export const definition: ToolDefinition<Input, string> = {
  name: 'agent-instructions',
  description: 'Read the workspace agent instructions (AGENTS.md)',
  inputSchema,
  category: 'system',
  riskLevel: 'safe',

  async execute(_input, _ctx) {
    // In the full implementation, this reads from WorkspaceContext.agentInstructions
    return {
      result: 'Agent instructions loaded from workspace context',
    };
  },
};
