/**
 * Context Manager -- handles context overflow detection, pruning, and compaction.
 *
 * Extracted from loop.ts (lines 473-629) to isolate the 150-line compaction
 * flow into a self-contained module. Compaction is a "loop citizen" -- it
 * runs as part of a regular iteration, not as a special pre-execution step.
 */

import type { Message, ProviderConfig } from '@coding-assistant/shared';
import type { WorkspaceContext } from '../workspace/context.js';
import type { SessionContext } from '../session/context.js';
import type { ExecutionDeps, StepScope } from './types.js';
import type { RawStreamEvent } from './stream-mapper.js';
import type { ModelMsg } from './message-builder.js';
import { convertMessages } from './message-builder.js';
import { insertReminders } from './reminders.js';
import { buildTaskReminder } from './message-prep.js';
import {
  shouldCompact,
  estimateTokenCount,
} from '../context/budget.js';
import { pruneMessages } from '../context/pruning.js';
import {
  recentMessages,
  activeTodos,
  activeTaskOperations,
  recentEdits,
  firstUserMessage,
} from '../context/protections.js';
import {
  prepareCompaction,
  buildCompactionPrompt,
  createSummaryMessage,
} from '../context/compaction.js';
import {
  mapCompactionStart,
  mapCompactionDone,
  mapContextPruned,
} from './stream-mapper.js';
import { stepCountIs } from 'ai';
import type { ModelMessage } from 'ai';

// ── Types ────────────────────────────────────────────────────────────────

export interface ContextResult {
  messages: ModelMsg[];
  events: RawStreamEvent[];
}

// ── Main ─────────────────────────────────────────────────────────────────

export async function prepareContext(
  deps: ExecutionDeps,
  workspace: WorkspaceContext,
  session: SessionContext,
  scope: StepScope,
  rawMessages: Message[],
  contextLimit: number,
  modelString: string,
  providerConfigs: Record<string, ProviderConfig>,
): Promise<ContextResult> {
  if (!shouldCompact(rawMessages, contextLimit)) {
    return { messages: convertMessages(rawMessages), events: [] };
  }

  const events: RawStreamEvent[] = [];
  const agent = deps.agentRegistry.resolve(session.agentId);
  const tokensBefore = estimateTokenCount(session.timeline.messages);

  // Phase 1: Prune (fast path)
  const protectionRules = [
    recentMessages(6),
    activeTodos(),
    activeTaskOperations(),
    recentEdits(5),
    firstUserMessage(),
  ];
  const targetTokens = Math.floor(contextLimit * 0.7);
  const { messages: prunedMessages, prunedCount, prunedTokens } = pruneMessages(
    session.timeline.messages,
    targetTokens,
    protectionRules,
  );

  // Phase 2: Compact via LLM (slow path -- summarize old messages)
  const { toSummarize, toKeep } = prepareCompaction(prunedMessages, 10);

  let finalMessages: ModelMsg[];

  if (toSummarize.length > 0) {
    finalMessages = await runLLMCompaction(
      deps, session, workspace, scope, agent,
      toSummarize, toKeep, prunedMessages,
      modelString, providerConfigs, events,
    );
  } else if (prunedCount > 0) {
    session.timeline.replaceMessages(prunedMessages as Message[]);
    finalMessages = convertMessages(
      insertReminders(session.timeline.messages, agent.id, session.previousAgentId),
    );
  } else {
    finalMessages = convertMessages(rawMessages);
  }

  if (prunedCount > 0) {
    events.push(mapContextPruned(scope, {
      prunedCount,
      prunedTokens,
      contextLimit,
      tokensBefore,
      tokensAfter: tokensBefore - prunedTokens,
    }));
  }

  return { messages: finalMessages, events };
}

// ── Internals ────────────────────────────────────────────────────────────

async function runLLMCompaction(
  deps: ExecutionDeps,
  session: SessionContext,
  workspace: WorkspaceContext,
  scope: StepScope,
  agent: import('@coding-assistant/shared').AgentProfile,
  toSummarize: readonly Message[],
  toKeep: readonly Message[],
  prunedMessages: readonly Message[],
  modelString: string,
  providerConfigs: Record<string, ProviderConfig>,
  events: RawStreamEvent[],
): Promise<ModelMsg[]> {
  const compactTokens = estimateTokenCount(toSummarize);
  events.push(mapCompactionStart(scope, {
    messagesToCompact: toSummarize.length,
    estimatedTokens: compactTokens,
  }));

  const summarizeAgent = deps.summarizeAgent;
  const compactionPrompt = buildCompactionPrompt(toSummarize);
  const summarizeModel = deps.resolveModel(
    summarizeAgent.model ?? modelString, providerConfigs,
  );
  const summaryResult = deps.streamText({
    model: summarizeModel.provider(summarizeModel.modelId),
    system: summarizeAgent.systemPrompt,
    messages: [{ role: 'user', content: compactionPrompt }] as ModelMessage[],
    maxOutputTokens: summarizeAgent.maxOutputTokens,
    temperature: summarizeAgent.temperature,
    stopWhen: stepCountIs(1),
  });

  let summaryText = '';
  for await (const sPart of summaryResult.fullStream) {
    if (sPart.type === 'text-delta') summaryText += sPart.text;
  }

  if (summaryText) {
    const summaryMsg = createSummaryMessage(
      session.id, summaryText, toSummarize.length, compactTokens,
    );
    const compactedMessages = [summaryMsg, ...toKeep];
    session.timeline.replaceMessages(compactedMessages);

    injectTaskContext(workspace, session);

    const finalMessages = convertMessages(
      insertReminders(session.timeline.messages, agent.id, session.previousAgentId),
    );

    events.push(mapCompactionDone(scope, {
      messagesCompacted: toSummarize.length,
      tokensFreed: compactTokens - estimateTokenCount([summaryMsg]),
      summaryTokens: estimateTokenCount([summaryMsg]),
    }));

    return finalMessages;
  }

  // Fallback: compaction LLM failed, use pruned messages
  session.timeline.replaceMessages(prunedMessages as Message[]);
  return convertMessages(
    insertReminders(session.timeline.messages, agent.id, session.previousAgentId),
  );
}

async function injectTaskContext(
  workspace: WorkspaceContext,
  session: SessionContext,
): Promise<void> {
  if (session.isSubagent) return;

  try {
    const { readTasksForSession } = await import('../workspace/task-store.js');
    const taskState = await readTasksForSession(workspace.id, session.id);
    const activeTasks = taskState.tasks.filter(
      (t) => t.status === 'pending' || t.status === 'in_progress',
    );

    if (activeTasks.length === 0) return;

    const taskReminder = buildTaskReminder(activeTasks);
    const timelineMsgs = session.timeline.messages;

    for (let ri = timelineMsgs.length - 1; ri >= 0; ri--) {
      if (timelineMsgs[ri].role === 'user') {
        const updated = {
          ...timelineMsgs[ri],
          parts: [
            ...timelineMsgs[ri].parts,
            {
              type: 'text' as const,
              id: `task_ctx_${Date.now()}`,
              index: timelineMsgs[ri].parts.length,
              text: taskReminder,
              synthetic: true,
            },
          ],
        };
        const newMsgs = [...timelineMsgs];
        newMsgs[ri] = updated;
        session.timeline.replaceMessages(newMsgs);
        break;
      }
    }
  } catch {
    // Non-critical: task injection failure shouldn't block execution
  }
}
