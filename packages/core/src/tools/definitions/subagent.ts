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
 *
 * Constraints:
 * - Max 5 concurrent subagents per parent session
 * - Subagents cannot spawn further subagents (recursion prevention)
 */

import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

/** Maximum number of subagents a single parent session can spawn. */
const MAX_SUBAGENTS = 5;

/** Tracks active subagent count per parent session ID. */
const activeSubagentCounts = new Map<string, number>();

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

The agent runs in a child session and returns its findings/results.
Maximum ${MAX_SUBAGENTS} subagents can be active per session.`,
  inputSchema,
  category: 'agent',
  riskLevel: 'moderate',

  async execute(input, ctx) {
    // Dynamically import to avoid circular dependencies at module level
    const { SessionContext } = await import('../../session/context.js');
    const { executeStream } = await import('../../execution/loop.js');
    const { agentRegistry } = await import('../../agents/index.js');
    type WorkspaceContext = import('../../workspace/context.js').WorkspaceContext;

    // Block recursion: subagents cannot spawn further subagents
    if (ctx.isSubagent) {
      return {
        result: 'Error: subagents cannot spawn further subagents.',
      };
    }

    const workspace = ctx.workspaceRef as WorkspaceContext | undefined;
    if (!workspace) {
      return {
        result: 'Error: workspace reference not available for subagent execution.',
      };
    }

    // Enforce max subagent limit
    const currentCount = activeSubagentCounts.get(ctx.sessionId) ?? 0;
    if (currentCount >= MAX_SUBAGENTS) {
      return {
        result: `Error: maximum ${MAX_SUBAGENTS} subagents reached for this session. Wait for existing subagents to complete.`,
      };
    }

    // Validate agent type
    const agent = agentRegistry.resolve(input.agentType);
    if (!agent) {
      return {
        result: `Unknown agent type: ${input.agentType}. Available: explore, build`,
      };
    }

    // Track active subagent count
    activeSubagentCounts.set(ctx.sessionId, currentCount + 1);

    // Create a child session context with recursion prevention
    const childSessionId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const childSession = new SessionContext({
      id: childSessionId,
      workspace,
      agentId: input.agentType,
      isSubagent: true,
      deniedToolCategories: ['agent'], // Prevent subagent recursion
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

      // Decrement active subagent count
      const count = activeSubagentCounts.get(ctx.sessionId) ?? 1;
      if (count <= 1) {
        activeSubagentCounts.delete(ctx.sessionId);
      } else {
        activeSubagentCounts.set(ctx.sessionId, count - 1);
      }
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
