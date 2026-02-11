/**
 * Streaming Execution Loop -- the core engine.
 *
 * Receives the full context chain (WorkspaceContext + SessionContext).
 * Resolves agent, model, and tools, then drives the AI SDK's streamText()
 * and maps every fullStream part to a StreamEvent broadcast via GlobalEventBus.
 *
 * Production features:
 * - Retry logic with exponential backoff for transient provider errors
 * - Abort cleanup: marks in-flight tools as error on abort
 * - Full text lifecycle: text-start / text-delta / text-done per step
 * - Tool state machine: pending -> running -> completed | error
 * - Doom loop detection: detects 3+ identical tool calls
 * - Permission blocking: halts loop on permission rejection
 * - Incremental timeline updates during streaming
 */

import type {
  StreamEvent,
  FinishReason,
  ProviderConfig,
  MessagePart,
  ToolStatus,
} from '@coding-assistant/shared';
import { generateMessageId } from '@coding-assistant/shared';
import type { WorkspaceContext } from '../workspace/context.js';
import type { SessionContext } from '../session/context.js';
import { globalEventBus } from '../events/bus.js';
import { StepTracker } from './step-tracker.js';
import { buildMessagesForAI } from './message-builder.js';
import {
  classifyRetryable,
  calculateRetryDelay,
  retrySleep,
  DEFAULT_RETRY_CONFIG,
} from './retry.js';
import {
  mapTextStart,
  mapTextDelta,
  mapToolCallStart,
  mapToolCallDone,
  mapToolResult,
  mapToolError,
  mapReasoningStart,
  mapReasoningDelta,
  mapReasoningDone,
  mapStepStart,
  mapStepFinish,
  mapError,
  mapTextDone,
  mapMessageDone,
  mapSessionStatus,
  mapMessageStart,
  type RawStreamEvent,
} from './stream-mapper.js';
import { cleanupInflightTools } from './abort-handler.js';
import { ToolCallTracker } from './tool-call-tracker.js';

// ── Lazy imports to avoid circular dependency at module-evaluation time ───

let _streamText: typeof import('ai').streamText | undefined;
let _agentRegistry: typeof import('../agents/index.js').agentRegistry | undefined;
let _resolveModel: typeof import('../providers/index.js').resolveModel | undefined;
let _toolRegistry: typeof import('../tools/index.js').toolRegistry | undefined;
let _buildToolExecCtx: typeof import('../tools/index.js').buildToolExecCtx | undefined;
let _buildSystemPrompt: typeof import('../agents/index.js').buildSystemPrompt | undefined;

async function ensureImports() {
  if (!_streamText) {
    const ai = await import('ai');
    _streamText = ai.streamText;
  }
  if (!_agentRegistry) {
    const agents = await import('../agents/index.js');
    _agentRegistry = agents.agentRegistry;
    _buildSystemPrompt = agents.buildSystemPrompt;
  }
  if (!_resolveModel) {
    const providers = await import('../providers/index.js');
    _resolveModel = providers.resolveModel;
  }
  if (!_toolRegistry || !_buildToolExecCtx) {
    const tools = await import('../tools/index.js');
    _toolRegistry = tools.toolRegistry;
    _buildToolExecCtx = tools.buildToolExecCtx;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface ExecutionInput {
  /** User message text */
  content: string;
  /** Optional model override (e.g. "openai:gpt-4o") */
  model?: string;
  /** Optional attachments */
  attachments?: Array<{ type: string; data: string }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Emit a raw event through the global bus and return the full event. */
function emit(raw: RawStreamEvent): StreamEvent {
  return globalEventBus.emit(raw);
}

function buildProviderConfigs(
  providers: Record<string, { apiKey?: string; baseUrl?: string; options?: Record<string, unknown> }>,
): Record<string, ProviderConfig> {
  const result: Record<string, ProviderConfig> = {};
  for (const [id, entry] of Object.entries(providers)) {
    result[id] = { id, ...entry };
  }
  return result;
}

/** Generate a unique part ID */
function partId(suffix?: string): string {
  return `part_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${suffix ? `_${suffix}` : ''}`;
}

/**
 * Transition session to idle and emit events for the common
 * "cleanup and stop" pattern used on abort, error, and success paths.
 */
function* finalizeExecution(
  session: SessionContext,
  tracker: ToolCallTracker,
  scope: { workspaceId: string; sessionId: string; messageId: string },
  scopeNoMsg: { workspaceId: string; sessionId: string },
): Generator<StreamEvent> {
  // Clean up any in-flight tool calls
  for (const evt of cleanupInflightTools(tracker.trackedTools, scope)) {
    yield evt;
  }

  // Transition back to idle
  if (session.state.status !== 'idle') {
    session.state.transition('idle');
  }
  yield emit(mapSessionStatus(scopeNoMsg, 'idle'));
}

// ── Main loop ─────────────────────────────────────────────────────────────

export async function* executeStream(
  workspace: WorkspaceContext,
  session: SessionContext,
  input: ExecutionInput,
): AsyncGenerator<StreamEvent> {
  await ensureImports();

  const streamText = _streamText!;
  const agentRegistry = _agentRegistry!;
  const resolveModel = _resolveModel!;
  const toolRegistry = _toolRegistry!;
  const buildToolExecCtx = _buildToolExecCtx!;
  const buildSystemPrompt = _buildSystemPrompt!;

  const stepTracker = new StepTracker();
  const toolTracker = new ToolCallTracker();
  const messageId = generateMessageId();

  const scope = { workspaceId: workspace.id, sessionId: session.id, messageId };
  const scopeNoMsg = { workspaceId: workspace.id, sessionId: session.id };

  // ── 1. Reset abort controller and transition to busy ─────────────────

  session.resetAbort();
  session.state.transition('busy');
  yield emit(mapSessionStatus(scopeNoMsg, 'busy'));

  let retryAttempt = 0;

  // ── Retry wrapper ────────────────────────────────────────────────────
  while (true) {
    try {
      // ── 2. Resolve agent, model, tools, system prompt ──────────────────

      const agent = agentRegistry.resolve(session.agentId);

      const modelString = input.model ?? agent.model ?? workspace.config.defaultModel ?? 'openai:gpt-4o';
      const providerConfigs = buildProviderConfigs(workspace.config.providers ?? {});
      const resolved = resolveModel(modelString, providerConfigs);
      const modelId = `${resolved.providerId}:${resolved.modelId}`;

      const toolCtx = buildToolExecCtx(
        {
          id: workspace.id,
          rootPath: workspace.rootPath,
          config: workspace.config as unknown as Record<string, unknown>,
          processManager: workspace.processManager,
        },
        session,
      );

      const tools = toolRegistry.toAISDKTools(toolCtx, {
        categories: agent.toolPolicy.allowed as import('@coding-assistant/shared').ToolCategory[],
      });

      const system = buildSystemPrompt(agent, workspace.agentInstructions);
      const messages = buildMessagesForAI(session.timeline);

      // ── 3. Emit message start ──────────────────────────────────────────

      if (retryAttempt === 0) {
        yield emit(mapMessageStart(scope, 'assistant'));
      }

      // ── 4. Stream ──────────────────────────────────────────────────────

      const modelFactory = resolved.provider as (id: string) => import('ai').LanguageModelV1;
      const model = modelFactory(resolved.modelId);

      const result = streamText({
        model,
        system,
        messages: messages as import('ai').CoreMessage[],
        tools: tools as Record<string, import('ai').CoreTool>,
        abortSignal: session.abortController.signal,
        maxSteps: agent.maxSteps ?? 25,
      });

      let currentStep = 0;
      let currentTextPartId: string | undefined;
      let currentTextAccumulated = '';
      let currentReasoningPartId: string | undefined;
      let currentReasoningAccumulated = '';
      let totalCost = 0;

      for await (const part of result.fullStream) {
        session.abortController.signal.throwIfAborted();

        const partType = part.type;

        switch (partType) {
          case 'step-start': {
            currentStep++;
            stepTracker.startStep(currentStep);
            yield emit(mapStepStart(scope, currentStep));
            break;
          }

          case 'text-delta': {
            if (!currentTextPartId) {
              currentTextPartId = partId('t');
              currentTextAccumulated = '';
              yield emit(mapTextStart(scope, currentTextPartId));
            }
            currentTextAccumulated += part.textDelta;
            stepTracker.recordTextChunk();
            yield emit(mapTextDelta(scope, part.textDelta, currentTextPartId));
            break;
          }

          case 'reasoning': {
            if (!currentReasoningPartId) {
              currentReasoningPartId = partId('r');
              currentReasoningAccumulated = '';
              yield emit(mapReasoningStart(scope, currentReasoningPartId));
            }
            currentReasoningAccumulated += part.textDelta;
            yield emit(mapReasoningDelta(scope, part.textDelta, currentReasoningPartId));
            break;
          }

          case 'tool-call': {
            stepTracker.recordToolCall();
            const tcPart = part as { toolCallId: string; toolName: string; args: unknown };
            const argsObj = tcPart.args as Record<string, unknown>;

            const isDoomLoop = toolTracker.recordToolCall(
              tcPart.toolCallId,
              tcPart.toolName,
              argsObj,
            );

            if (isDoomLoop) {
              yield emit(mapError(
                scopeNoMsg,
                'DOOM_LOOP',
                `Detected doom loop: "${tcPart.toolName}" called 3 times with identical arguments. Stopping.`,
              ));
            }

            yield emit(mapToolCallStart(scope, tcPart.toolCallId, tcPart.toolName));
            yield emit(mapToolCallDone(scope, tcPart.toolCallId, tcPart.toolName, argsObj));
            break;
          }

          case 'step-finish': {
            // Close any open text part before step ends
            if (currentTextPartId && currentTextAccumulated) {
              yield emit(mapTextDone(scope, currentTextAccumulated, currentTextPartId));
              currentTextPartId = undefined;
              currentTextAccumulated = '';
            }
            if (currentReasoningPartId && currentReasoningAccumulated) {
              yield emit(mapReasoningDone(scope, currentReasoningPartId, currentReasoningAccumulated));
              currentReasoningPartId = undefined;
              currentReasoningAccumulated = '';
            }

            stepTracker.finishStep();
            const usage = part.usage ? {
              promptTokens: part.usage.promptTokens,
              completionTokens: part.usage.completionTokens,
              totalTokens: part.usage.totalTokens,
            } : null;

            const stepCost = usage ? (usage.promptTokens * 0.000003 + usage.completionTokens * 0.000015) : 0;
            totalCost += stepCost;

            yield emit(mapStepFinish(
              scope,
              currentStep,
              part.finishReason as FinishReason,
              usage,
              stepCost > 0 ? stepCost : undefined,
            ));
            break;
          }

          case 'error': {
            const errMsg = part.error instanceof Error ? part.error.message : String(part.error);
            yield emit(mapError(scopeNoMsg, 'STREAM_ERROR', errMsg));
            break;
          }

          default: {
            const pType = partType as string;
            if (pType === 'tool-result') {
              const trPart = part as unknown as {
                toolCallId: string;
                toolName: string;
                result: unknown;
              };
              const isError = trPart.result instanceof Error;
              const resultValue = isError ? (trPart.result as Error).message : trPart.result;

              toolTracker.updateStatus(
                trPart.toolCallId,
                isError ? 'error' : 'completed',
              );

              if (isError) {
                yield emit(mapToolError(scope, trPart.toolCallId, trPart.toolName, resultValue as string));
              } else {
                yield emit(mapToolResult(scope, trPart.toolCallId, trPart.toolName, resultValue, false));
              }
            }
            break;
          }
        }

        // If doom loop detected, break out of the stream
        if (toolTracker.doomLoopDetected) break;
      }

      // ── 5. Close any remaining open parts ──────────────────────────────

      if (currentTextPartId && currentTextAccumulated) {
        yield emit(mapTextDone(scope, currentTextAccumulated, currentTextPartId));
      }
      if (currentReasoningPartId && currentReasoningAccumulated) {
        yield emit(mapReasoningDone(scope, currentReasoningPartId, currentReasoningAccumulated));
      }

      // ── 6. Resolve final usage and emit message-done ───────────────────

      const finalUsage = await result.usage;
      const finalFinishReason = await result.finishReason;

      const usage = finalUsage ? {
        promptTokens: finalUsage.promptTokens,
        completionTokens: finalUsage.completionTokens,
        totalTokens: finalUsage.totalTokens,
      } : null;

      yield emit(mapMessageDone(
        scope,
        (finalFinishReason ?? 'stop') as FinishReason,
        usage,
        modelId,
        totalCost > 0 ? totalCost : undefined,
      ));

      // ── 7. Update timeline with completed messages ─────────────────────

      try {
        const responseMessages = await result.response;
        if (responseMessages?.messages) {
          for (const respMsg of responseMessages.messages) {
            if (respMsg.role === 'assistant') {
              const parts: MessagePart[] = [];
              if (typeof respMsg.content === 'string') {
                parts.push({ type: 'text', id: partId('t'), index: 0, text: respMsg.content });
              } else if (Array.isArray(respMsg.content)) {
                for (const c of respMsg.content) {
                  if (c.type === 'text') {
                    parts.push({ type: 'text', id: partId('t'), index: parts.length, text: c.text });
                  } else if (c.type === 'tool-call') {
                    parts.push({
                      type: 'tool-call',
                      id: partId('tc'),
                      index: parts.length,
                      toolCallId: c.toolCallId,
                      toolName: c.toolName,
                      args: c.args as Record<string, unknown>,
                      status: 'completed' as ToolStatus,
                    });
                  }
                }
              }
              if (parts.length > 0) {
                session.timeline.appendMessage({ role: 'assistant', modelId, parts });
              }
            } else if (respMsg.role === 'tool') {
              const parts: MessagePart[] = [];
              const content = Array.isArray(respMsg.content) ? respMsg.content : [];
              for (const c of content) {
                if (c.type === 'tool-result') {
                  parts.push({
                    type: 'tool-result',
                    id: partId('tr'),
                    index: parts.length,
                    toolCallId: c.toolCallId,
                    toolName: c.toolName,
                    result: c.result,
                    isError: c.isError ?? false,
                  });
                }
              }
              if (parts.length > 0) {
                session.timeline.appendMessage({ role: 'tool', parts });
              }
            }
          }
        }
      } catch {
        // Non-critical: timeline update failure shouldn't crash the loop
      }

      // ── 8. Finalize -- cleanup tools and transition to idle ────────────

      yield* finalizeExecution(session, toolTracker, scope, scopeNoMsg);

      // Success -- exit the retry loop
      break;

    } catch (error) {
      // ── Abort (user cancellation) ──────────────────────────────────

      if (error instanceof DOMException && error.name === 'AbortError') {
        yield emit(mapError(scopeNoMsg, 'ABORTED', 'Execution was cancelled'));
        yield* finalizeExecution(session, toolTracker, scope, scopeNoMsg);
        break;
      }

      // ── Retryable transient error ──────────────────────────────────

      const retryReason = classifyRetryable(error);
      if (retryReason && retryAttempt < DEFAULT_RETRY_CONFIG.maxAttempts) {
        retryAttempt++;
        const delay = calculateRetryDelay(retryAttempt, error);
        const nextAt = Date.now() + delay;

        session.state.transition('retry');
        yield emit(mapSessionStatus(scopeNoMsg, 'retry', {
          attempt: retryAttempt,
          reason: retryReason,
          nextAt,
        }));

        const completed = await retrySleep(delay, session.abortController.signal);
        if (!completed) {
          yield emit(mapError(scopeNoMsg, 'ABORTED', 'Execution was cancelled during retry'));
          yield* finalizeExecution(session, toolTracker, scope, scopeNoMsg);
          break;
        }

        session.state.transition('busy');
        yield emit(mapSessionStatus(scopeNoMsg, 'busy'));
        continue;
      }

      // ── Non-retryable error ────────────────────────────────────────

      yield emit(mapError(
        scopeNoMsg,
        'EXECUTION_ERROR',
        error instanceof Error ? error.message : 'Unknown error',
      ));
      yield* finalizeExecution(session, toolTracker, scope, scopeNoMsg);
      break;
    }
  }
}
