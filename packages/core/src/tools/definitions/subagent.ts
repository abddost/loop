/**
 * Subagent tool -- spawns a child session with a focused agent profile.
 *
 * Creates an isolated child session linked to the parent's workspace,
 * executes the subagent's loop to completion, and returns the accumulated
 * text output as the tool result.
 *
 * All child stream events are forwarded through the global event bus
 * as `subagent-child-event` so the frontend can render live streaming
 * inside the SubagentCard.
 *
 * Available agents:
 * - `explore`: Fast, read-only agent for codebase exploration (file-read + search only)
 * - `universal`: Full-capability agent for multi-step tasks (all tools except subagent)
 *
 * The child session is fully isolated:
 * - Own timeline (messages don't leak into parent)
 * - Own abort controller (parent abort propagates to child)
 * - Own tool tracker (doom loop detection is per-session)
 *
 * Features:
 * - DB-backed session persistence via SessionManager
 * - task_id resumption: pass a previous session ID to continue where it left off
 * - Live event forwarding: all child events are re-emitted on the parent's scope
 *
 * Constraints:
 * - Subagents cannot spawn further subagents (recursion prevention)
 */

import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  description: z.string().describe('Short (3-5 word) description of the task'),
  prompt: z.string().describe('Detailed task for the agent to perform'),
  agentType: z
    .enum(['explore', 'universal'])
    .describe('Which agent type to use: explore (read-only) or universal (full write/edit/bash capability)'),
  task_id: z.string().optional().describe(
    'Resume a previous subagent session by passing the task_id from a prior result',
  ),
});

type Input = z.infer<typeof inputSchema>;

export const definition: ToolDefinition<Input, string> = {
  name: 'subagent',
  description: `Launch a specialized agent to handle a focused task autonomously.

Available agent types:
- explore: Fast read-only agent for codebase exploration (file-read + search only)
- universal: Full-capability agent for multi-step tasks (write, edit, bash, search)

When to use:
- Complex multi-step research requiring many file reads across directories
- Tasks that benefit from a separate context window (isolation)
- Parallel investigations (launch multiple agents in one message)

When NOT to use:
- To read a specific file -- use file-read tools directly
- To search for a class/function -- use search tools directly
- To make a simple edit to 1-3 files -- do it directly
- Never delegate your primary task to a subagent

Usage notes:
- Launch multiple agents concurrently with multiple tool calls in one message
- Each invocation is fresh unless you provide task_id to resume a previous session
- Provide detailed, self-contained prompts -- the agent has no parent context
- Tell the agent exactly what to return in its final message
- The output includes a task_id for resuming the same session later`,
  inputSchema,
  category: 'agent',
  riskLevel: 'moderate',

  async execute(input, ctx) {
    // Dynamically import to avoid circular dependencies at module level
    const { SessionContext } = await import('../../session/context.js');
    const { executeStream } = await import('../../execution/loop.js');
    const { agentRegistry } = await import('../../agents/index.js');
    const { globalEventBus } = await import('../../events/bus.js');
    const {
      mapSubagentStart,
      mapSubagentChildEvent,
      mapSubagentDone,
    } = await import('../../execution/stream-mapper.js');
    type WorkspaceContext = import('../../workspace/context.js').WorkspaceContext;
    type SessionManager = import('../../session/manager.js').SessionManager;

    // Block recursion: subagents cannot spawn further subagents
    if (ctx.isSubagent) {
      return {
        result: 'Error: subagents cannot spawn further subagents.',
      };
    }

    await ctx.ask({
      permission: 'task',
      patterns: [input.agentType],
      always: ['*'],
      metadata: {
        toolName: 'subagent',
        description: input.description,
        subagent_type: input.agentType,
      },
    });

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
        result: `Unknown agent type: ${input.agentType}. Available: explore, universal`,
      };
    }

    // Build parent scope for event forwarding
    const toolCallId = ctx.toolCallId ?? `tcid_${Date.now()}`;
    const parentScope = {
      workspaceId: ctx.workspaceId,
      sessionId: ctx.sessionId,
      messageId: ctx.messageId ?? '',
    };

    // Create or restore child session
    const sessionManager = ctx.sessionManager as SessionManager | undefined;
    let childSession: import('../../session/context.js').SessionContext;
    let resumed = false;

    if (input.task_id && sessionManager) {
      // Try to resume a previous subagent session
      const restored = sessionManager.restoreSubagentSession(workspace, input.task_id);
      if (restored) {
        childSession = restored;
        resumed = true;
      } else {
        // Fallback: create a new session if restoration fails
        childSession = sessionManager
          ? sessionManager.createSubagentSession(workspace, ctx.sessionId, input.agentType)
          : new SessionContext({
              id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              workspace,
              agentId: input.agentType,
              isSubagent: true,
              deniedToolCategories: ['agent'],
            });
      }
    } else if (sessionManager) {
      childSession = sessionManager.createSubagentSession(workspace, ctx.sessionId, input.agentType);
    } else {
      // No SessionManager available -- create a transient session (no persistence)
      childSession = new SessionContext({
        id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        workspace,
        agentId: input.agentType,
        isSubagent: true,
        deniedToolCategories: ['agent'],
      });
    }

    const childSessionId = childSession.id;

    // Add the user prompt to the child session's timeline
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

    const startTime = Date.now();
    let resultText = '';
    // Fallback: collect full text from text-done events (authoritative per step)
    let textDoneAccumulated = '';
    // Collect error messages for diagnostics
    const errors: string[] = [];

    // Emit subagent-start event
    globalEventBus.emit(mapSubagentStart(
      parentScope,
      toolCallId,
      childSessionId,
      input.agentType,
      input.description,
      resumed,
    ));

    try {
      const stream = executeStream(workspace, childSession, {
        content: input.prompt,
      });

      for await (const event of stream) {
        // Collect text for the final result (streaming deltas)
        if (event.type === 'text-delta') {
          resultText += (event as { delta: string }).delta;
        }

        // Also collect text-done events as reliable fallback
        // (full accumulated text per step, emitted even if text-delta was missed)
        if (event.type === 'text-done') {
          textDoneAccumulated += (event as { text: string }).text;
        }

        // Collect error events for diagnostics
        if (event.type === 'error') {
          const errEvent = event as { code?: string; message?: string };
          const errMsg = errEvent.message ?? errEvent.code ?? 'unknown error';
          errors.push(errMsg);
          console.warn(`[subagent] Child error event: ${errMsg}`);
        }

        // Forward ALL child events to parent scope for live UI rendering
        // Spread event fields into childEvent; event.type is the discriminator
        const { globalSeq: _seq, ...childEventData } = event as unknown as Record<string, unknown>;
        globalEventBus.emit(mapSubagentChildEvent(
          parentScope,
          toolCallId,
          childSessionId,
          childEventData,
        ));

        // Check if parent was aborted
        if (ctx.abort.aborted) {
          childSession.cancel();
          break;
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startTime;

      // Emit subagent-done with error
      globalEventBus.emit(mapSubagentDone(
        parentScope,
        toolCallId,
        childSessionId,
        input.agentType,
        durationMs,
        0,
        errMsg,
      ));

      return {
        result: [
          `task_id: ${childSessionId} (for resuming this agent's work if needed)`,
          '',
          `Subagent error: ${errMsg}`,
        ].join('\n'),
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

    const durationMs = Date.now() - startTime;

    // Use text-done fallback if text-delta collection missed anything
    if (!resultText && textDoneAccumulated) {
      console.warn(`[subagent] Using text-done fallback (text-delta was empty but text-done had content)`);
      resultText = textDoneAccumulated;
    }

    // Emit subagent-done event
    globalEventBus.emit(mapSubagentDone(
      parentScope,
      toolCallId,
      childSessionId,
      input.agentType,
      durationMs,
      resultText.length,
      // If no text was produced and we have errors, report them
      !resultText && errors.length > 0 ? errors.join('; ') : undefined,
    ));

    if (!resultText) {
      console.warn(`[subagent] Agent "${input.agentType}" (${childSessionId}) completed without text output.`);
      if (errors.length > 0) {
        console.warn(`[subagent] Errors during execution: ${errors.join('; ')}`);
      }
    }

    // Build output: include error details when no text was produced
    let body: string;
    if (resultText) {
      body = resultText;
    } else if (errors.length > 0) {
      body = `Agent completed without text output.\n\nErrors encountered during execution:\n${errors.map(e => `- ${e}`).join('\n')}`;
    } else {
      body = 'Agent completed without text output.';
    }

    const output = [
      `task_id: ${childSessionId} (for resuming this agent's work if needed)`,
      '',
      '<task_result>',
      body,
      '</task_result>',
    ].join('\n');

    return {
      result: output,
      metadata: {
        agentType: input.agentType,
        sessionId: childSessionId,
        description: input.description,
        durationMs,
        resumed,
      },
    };
  },
};
