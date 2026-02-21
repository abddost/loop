/**
 * Streaming Execution Loop -- the core engine.
 *
 * Orchestrates the AI agent's multi-step execution cycle. Each iteration
 * calls streamText() with stepCountIs(1) (one LLM call per iteration),
 * giving natural between-step decision points for compaction, pruning,
 * and agent switching.
 *
 * Delegates to focused modules for each concern:
 * - step-resolver.ts   -- agent/model/tools resolution
 * - message-prep.ts    -- message reading + reminder injection
 * - context-manager.ts -- compaction + pruning orchestration
 * - step-processor.ts  -- stream event processing + timeline update
 * - error-handler.ts   -- error classification + retry logic
 */

import type { StreamEvent, FinishReason, Message } from '@coding-assistant/shared';
import { generateMessageId } from '@coding-assistant/shared';
import type { WorkspaceContext } from '../workspace/context.js';
import type { SessionContext } from '../session/context.js';
import { globalEventBus } from '../events/bus.js';
import { StepTracker } from './step-tracker.js';
import { ToolCallTracker } from './tool-call-tracker.js';
import { cleanupInflightTools } from './abort-handler.js';
import { captureSnapshot, diffSnapshots, type FileSnapshot } from './snapshot.js';
import { pruneToolOutputs } from '../context/tool-output-pruning.js';
import { generateSessionTitle } from '../session/title-generator.js';
import {
  transformMessages,
  getTemperature,
  getProviderOptions,
  getMaxOutputTokens,
} from '../providers/transform.js';
import {
  mapSessionStatus,
  mapMessageStart,
  mapFilePatch,
  type RawStreamEvent,
} from './stream-mapper.js';

import type { ModelMessage, ToolSet, JSONValue } from 'ai';
import { stepCountIs } from 'ai';

import type { ExecutionInput, StepScope } from './types.js';
import { loadExecutionDeps } from './deps.js';
import { resolveStep } from './step-resolver.js';
import { prepareMessages } from './message-prep.js';
import { prepareContext } from './context-manager.js';
import { StepProcessor } from './step-processor.js';
import { handleExecutionError } from './error-handler.js';
import { convertMessages } from './message-builder.js';
import { PermissionRejectedError } from '../permissions/permission.js';

export type { ExecutionInput };

// ── Helpers ───────────────────────────────────────────────────────────────

function emit(raw: RawStreamEvent): StreamEvent {
  return globalEventBus.emit(raw);
}

async function safeCaptureSnapshot(rootPath: string): Promise<FileSnapshot | undefined> {
  try {
    return await captureSnapshot(rootPath);
  } catch {
    return undefined;
  }
}

function* finalizeExecution(
  session: SessionContext,
  tracker: ToolCallTracker,
  scope: StepScope,
  scopeNoMsg: { workspaceId: string; sessionId: string },
): Generator<StreamEvent> {
  for (const evt of cleanupInflightTools(tracker.trackedTools, scope)) {
    yield evt;
  }
  if (session.state.status !== 'idle') {
    session.state.transition('idle');
  }
  yield emit(mapSessionStatus(scopeNoMsg, 'idle'));
}

// ── Main Loop ─────────────────────────────────────────────────────────────

export async function* executeStream(
  workspace: WorkspaceContext,
  session: SessionContext,
  input: ExecutionInput,
): AsyncGenerator<StreamEvent> {
  const deps = await loadExecutionDeps();

  const stepTracker = new StepTracker();
  const toolTracker = new ToolCallTracker();
  const scopeNoMsg = { workspaceId: workspace.id, sessionId: session.id };
  let scope!: StepScope;

  // 1. Reset abort controller and transition to busy
  session.resetAbort();
  session.state.transition('busy');
  yield emit(mapSessionStatus(scopeNoMsg, 'busy'));

  // 2. State that persists across steps
  let currentStep = 0;
  let lastModelId = '';
  let retryAttempt = 0;
  let titleGenerated = false;
  let stepSnapshot = await safeCaptureSnapshot(workspace.rootPath);

  // 3. Persistent step loop
  while (true) {
    const stepBefore = currentStep;

    const messageId = generateMessageId();
    scope = { ...scopeNoMsg, messageId };
    yield emit(mapMessageStart(scope, 'assistant'));

    try {
      session.abortController.signal.throwIfAborted();

      // A. Resolve agent, model, tools, system prompt
      const resolved = await resolveStep(deps, workspace, session, input, currentStep, scope, emit);
      lastModelId = resolved.modelId;

      // B. Read messages + inject reminders
      const rawMessages = prepareMessages(session, resolved.agent, currentStep, resolved.maxSteps);

      // C. Context management (compaction/pruning)
      const contextLimit = resolved.modelInfo?.limits?.context ?? 128_000;
      const ctx = await prepareContext(
        deps, workspace, session, scope, rawMessages,
        contextLimit, resolved.modelString, resolved.providerConfigs,
      );
      for (const evt of ctx.events) yield emit(evt);

      // D. Async title generation (fire-and-forget, once)
      if (!titleGenerated && !session.title && retryAttempt === 0) {
        titleGenerated = true;
        generateSessionTitle(
          workspace.id, session, input.content, resolved.modelString, resolved.providerConfigs,
        ).catch(() => {});
      }

      // E. Build model transforms and provider options
      let transformedMessages = ctx.messages;
      if (resolved.modelInfo) {
        transformedMessages = transformMessages(
          ctx.messages as { role: string; content?: unknown }[],
          resolved.modelInfo,
        ) as typeof ctx.messages;
      }
      const temperature = resolved.modelInfo ? getTemperature(resolved.modelInfo) : undefined;
      const maxOutputTokens = resolved.modelInfo ? getMaxOutputTokens(resolved.modelInfo) : undefined;
      const providerOptions = resolved.modelInfo
        ? getProviderOptions(resolved.modelInfo, session.id) as Record<string, Record<string, JSONValue>>
        : undefined;

      // F. Call streamText with stepCountIs(1)
      const result = deps.streamText({
        model: resolved.model,
        system: resolved.system,
        messages: transformedMessages as ModelMessage[],
        tools: resolved.tools as unknown as ToolSet,
        abortSignal: session.abortController.signal,
        stopWhen: stepCountIs(1),
        temperature,
        maxOutputTokens,
        providerOptions,
        async experimental_repairToolCall(failed) {
          const lower = failed.toolCall.toolName.toLowerCase();
          if (lower !== failed.toolCall.toolName && (resolved.tools as Record<string, unknown>)[lower]) {
            return { ...failed.toolCall, toolName: lower };
          }
          return {
            ...failed.toolCall,
            toolName: 'invalid',
            input: JSON.stringify({
              tool: failed.toolCall.toolName,
              error: failed.error instanceof Error ? failed.error.message : String(failed.error),
            }),
          };
        },
      });

      // G. Process stream via StepProcessor
      const processor = new StepProcessor(
        scope, scopeNoMsg, stepTracker, toolTracker, session.timeline, emit, currentStep,
      );

      const stepResult = yield* processor.process(
        result as unknown as Parameters<StepProcessor['process']>[0],
        session.abortController.signal,
        resolved.modelId,
        stepSnapshot,
        workspace.rootPath,
      );

      currentStep = processor.step;

      // H. File snapshot diff for per-step change tracking
      if (stepSnapshot) {
        try {
          const afterSnapshot = await captureSnapshot(workspace.rootPath);
          const patch = diffSnapshots(stepSnapshot, afterSnapshot);
          if (patch.files.length > 0) {
            yield emit(mapFilePatch(scope, currentStep, patch));
          }
          stepSnapshot = afterSnapshot;
        } catch {
          // Non-critical
        }
      }

      // I. Post-step tool output pruning
      pruneToolOutputs(session.timeline.messages as Message[]);

      // J. Loop control
      retryAttempt = 0;
      if (stepResult.stepResult === 'stop') break;

      // Doom loop: ask user for permission to continue instead of hard-halting
      if (stepResult.stepResult === 'doom-loop') {
        if (input.registerPermissionRequest) {
          try {
            const resolved2 = await resolveStep(deps, workspace, session, input, currentStep, scope, emit);
            const userPermConfig = (workspace.config as { permissions?: unknown }).permissions;
            const userRules = deps.Permission.fromConfig(
              (userPermConfig && typeof userPermConfig === 'object' ? userPermConfig : {}) as Record<string, 'allow' | 'deny' | 'ask' | Record<string, 'allow' | 'deny' | 'ask'>>,
            );
            const mergedRuleset = deps.Permission.merge(
              deps.defaultPermissionRules,
              resolved2.agent.permission ?? [],
              userRules,
            );
            await deps.Permission.ask({
              permission: 'doom_loop',
              patterns: ['*'],
              always: ['*'],
              metadata: { reason: 'Repeated identical tool calls detected' },
              sessionId: session.id,
              ruleset: mergedRuleset,
              workspaceId: workspace.id,
              abortSignal: session.abortController.signal,
              emitEvent: (event) => { emit(event as RawStreamEvent); },
              registerRequest: input.registerPermissionRequest,
              toolName: 'doom_loop',
              description: 'Agent appears stuck in a loop. Allow it to continue?',
              riskLevel: 'moderate',
            });
            // User approved — continue the loop
            continue;
          } catch (err) {
            if (err instanceof PermissionRejectedError) break;
            throw err;
          }
        }
        break;
      }

    } catch (error) {
      currentStep = stepBefore;
      const result = yield* handleExecutionError(
        error, session, scope, scopeNoMsg, retryAttempt, lastModelId, emit,
      );
      retryAttempt = result.retryAttempt;
      if (result.action === 'break') break;
    }
  }

  // 4. Post-loop: finalize
  yield* finalizeExecution(session, toolTracker, scope, scopeNoMsg);
}
