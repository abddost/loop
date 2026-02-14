/**
 * Subagent tool -- spawns a child session with a focused agent profile.
 *
 * Creates an isolated child session linked to the parent's workspace,
 * executes the subagent's loop to completion, and returns the accumulated
 * text output as the tool result.
 *
 * Available agents:
 * - `explore`: Fast, read-only agent for codebase exploration (file-read + search only)
 * - `build`: Full-capability agent for multi-step tasks (all tools except subagent)
 *
 * The child session is fully isolated:
 * - Own timeline (messages don't leak into parent)
 * - Own abort controller (parent abort propagates to child)
 * - Own tool tracker (doom loop detection is per-session)
 */

import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  description: z.string().describe('Short (3-5 word) description of the task'),
  prompt: z.string().describe('Detailed task for the agent to perform'),
  agentType: z
    .enum(['explore', 'build'])
    .describe('Which agent type to use: explore (read-only) or build (full access)'),
});

type Input = z.infer<typeof inputSchema>;

export const definition: ToolDefinition<Input, string> = {
  name: 'subagent',
  description: `Launch a specialized agent to handle a task autonomously.

Available agent types:
- explore: Fast, read-only agent for codebase exploration (has file-read + search only)
- build: Full-capability agent for multi-step tasks (has all tools except subagent)

The agent runs in a child session and returns its findings/results.`,
  inputSchema,
  category: 'agent',
  riskLevel: 'moderate',

  async execute(input, ctx) {
    // Dynamically import to avoid circular dependencies at module level
    const { SessionContext } = await import('../../session/context.js');
    const { executeStream } = await import('../../execution/loop.js');
    const { agentRegistry } = await import('../../agents/index.js');
    type WorkspaceContext = import('../../workspace/context.js').WorkspaceContext;

    const workspace = ctx.workspaceRef as WorkspaceContext | undefined;
    if (!workspace) {
      return {
        result: 'Error: workspace reference not available for subagent execution.',
      };
    }

    // Validate agent type
    const agent = agentRegistry.resolve(input.agentType);
    if (!agent) {
      return {
        result: `Unknown agent type: ${input.agentType}. Available: explore, build`,
      };
    }

    // Prevent subagent from spawning further subagents (avoid recursion)
    if (input.agentType === 'build') {
      // Build agent could theoretically call subagent again.
      // The tool registry filters tools by agent profile, and we can
      // rely on the agent's toolPolicy to exclude 'agent' category.
    }

    // Create a child session context
    const childSessionId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const childSession = new SessionContext({
      id: childSessionId,
      workspace,
      agentId: input.agentType,
    });

    // Add the user prompt to the child session's timeline
    // (executeStream reads from timeline, doesn't add user message itself)
    childSession.timeline.appendMessage({
      role: 'user',
      parts: [{
        type: 'text' as const,
        id: `sub_prompt_${Date.now()}`,
        index: 0,
        text: input.prompt,
      }],
    });

    // Propagate parent abort to child
    const parentAbortHandler = () => {
      childSession.cancel();
    };
    ctx.abort.addEventListener('abort', parentAbortHandler, { once: true });

    let resultText = '';

    try {
      const stream = executeStream(workspace, childSession, {
        content: input.prompt,
      });

      for await (const event of stream) {
        // Collect text output from the subagent
        if (event.type === 'text-delta') {
          resultText += event.delta;
        }
        // Check if parent was aborted
        if (ctx.abort.aborted) {
          childSession.cancel();
          break;
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        result: `Subagent error: ${errMsg}`,
        metadata: {
          agentType: input.agentType,
          sessionId: childSessionId,
          error: true,
        },
      };
    } finally {
      ctx.abort.removeEventListener('abort', parentAbortHandler);
      childSession[Symbol.dispose]();
    }

    return {
      result: resultText || 'Agent completed without text output.',
      metadata: {
        agentType: input.agentType,
        sessionId: childSessionId,
        description: input.description,
      },
    };
  },
};
