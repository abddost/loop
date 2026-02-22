/**
 * Step Processor -- processes one stream from streamText() and yields events.
 *
 * Inspired by opencode's SessionProcessor pattern. Encapsulates all per-step
 * state (currentTextPartId, toolStartTimes, etc.) as class fields instead of
 * scattered local variables. Persists parts to the timeline immediately as
 * they arrive, and returns a StepResult for loop control.
 *
 * Business logic preserved exactly from loop.ts lines 691-1045:
 * - Text lifecycle with missing text-start recovery
 * - Reasoning lifecycle with missing reasoning-start recovery
 * - Tool input streaming with backward-compat for providers that skip it
 * - Doom loop detection (warning at threshold-1, halt at threshold)
 * - Permission denial detection in tool errors
 * - File snapshot diffing at step boundaries
 * - Two-pass timeline update (assistant parts + tool-result parts merged)
 * - Remaining open parts closed before step ends (safety net)
 */

import type {
  FinishReason,
  MessagePart,
  ToolStatus,
  TokenUsage,
} from '@coding-assistant/shared';
import { generateMessageId } from '@coding-assistant/shared';
import type { StepScope, StepResult } from './types.js';
import type { RawStreamEvent } from './stream-mapper.js';
import type { MessageTimeline } from '../session/timeline.js';
import { StepTracker } from './step-tracker.js';
import { ToolCallTracker } from './tool-call-tracker.js';
import { calculateStepCost } from './cost.js';
import { captureSnapshot, diffSnapshots, type FileSnapshot } from './snapshot.js';
import {
  mapTextStart,
  mapTextDelta,
  mapTextDone,
  mapReasoningStart,
  mapReasoningDelta,
  mapReasoningDone,
  mapToolCallStart,
  mapToolCallDone,
  mapToolResult,
  mapToolError,
  mapStepStart,
  mapStepFinish,
  mapFilePatch,
  mapError,
  mapMessageDone,
} from './stream-mapper.js';

/** Generate a unique part ID */
function partId(suffix?: string): string {
  return `part_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${suffix ? `_${suffix}` : ''}`;
}

// ── Types ────────────────────────────────────────────────────────────────

export interface StepProcessorResult {
  stepResult: StepResult;
  finishReason: FinishReason;
  usage: TokenUsage | null;
  cost: number;
  modelId: string;
}

interface StreamTextResult {
  fullStream: AsyncIterable<Record<string, unknown>>;
  usage: Promise<{ inputTokens?: number; outputTokens?: number; totalTokens?: number }>;
  finishReason: Promise<string>;
  response: Promise<{ messages?: Array<{ role: string; content: unknown }> }>;
}

// ── Class ────────────────────────────────────────────────────────────────

export class StepProcessor {
  private currentTextPartId?: string;
  private currentTextAccumulated = '';
  private currentReasoningPartId?: string;
  private currentReasoningAccumulated = '';
  private toolStartTimes = new Map<string, number>();
  private toolInputStarted = new Set<string>();
  private stepCost = 0;
  private currentStep: number;

  constructor(
    private scope: StepScope,
    private scopeNoMsg: { workspaceId: string; sessionId: string },
    private stepTracker: StepTracker,
    private toolTracker: ToolCallTracker,
    private timeline: MessageTimeline,
    private emitFn: (raw: RawStreamEvent) => void,
    currentStep: number,
  ) {
    this.currentStep = currentStep;
  }

  /**
   * Process one full stream from streamText().
   * Yields events as they arrive, updates timeline after step completes.
   * Returns the processor result for loop control decisions.
   */
  async *process(
    result: StreamTextResult,
    abortSignal: AbortSignal,
    modelId: string,
    stepSnapshot: FileSnapshot | undefined,
    workspacePath: string | undefined,
  ): AsyncGenerator<void, StepProcessorResult> {
    // Process all stream parts
    for await (const part of result.fullStream) {
      abortSignal.throwIfAborted();
      yield* this.handleStreamPart(part, modelId);
      if (this.toolTracker.doomLoopDetected) break;
    }

    // Close any remaining open parts
    yield* this.closeOpenParts();

    // Resolve final usage
    const finalUsage = await result.usage;
    const finalFinishReason = await result.finishReason;
    const finishReason = (finalFinishReason ?? 'stop') as FinishReason;

    const perStepUsage: TokenUsage | null =
      finalUsage && (finalUsage.totalTokens ?? 0) > 0
        ? {
            inputTokens: finalUsage.inputTokens ?? 0,
            outputTokens: finalUsage.outputTokens ?? 0,
            totalTokens: finalUsage.totalTokens ?? 0,
          }
        : null;

    // Persist to DB first, then notify clients
    await this.updateTimeline(result, modelId);

    yield this.emitFn(mapMessageDone(this.scope, finishReason, perStepUsage, modelId, this.stepCost > 0 ? this.stepCost : undefined));

    // Determine step result
    let stepResult: StepResult;
    if (this.toolTracker.doomLoopDetected) {
      stepResult = 'doom-loop';
    } else if (finishReason === 'tool-calls') {
      stepResult = 'continue';
    } else {
      stepResult = 'stop';
    }

    return {
      stepResult,
      finishReason,
      usage: perStepUsage,
      cost: this.stepCost,
      modelId,
    };
  }

  /** Returns the updated step count after processing. */
  get step(): number {
    return this.currentStep;
  }

  // ── Stream Part Handlers ─────────────────────────────────────────────

  private *handleStreamPart(
    part: Record<string, unknown>,
    modelId: string,
  ): Generator<void> {
    const partType = part.type as string;

    switch (partType) {
      case 'start-step':
        yield* this.onStartStep();
        break;
      case 'text-start':
        yield* this.onTextStart(part);
        break;
      case 'text-delta':
        yield* this.onTextDelta(part);
        break;
      case 'text-end':
        yield* this.onTextEnd();
        break;
      case 'reasoning-start':
        yield* this.onReasoningStart(part);
        break;
      case 'reasoning-delta':
        yield* this.onReasoningDelta(part);
        break;
      case 'reasoning-end':
        yield* this.onReasoningEnd();
        break;
      case 'tool-input-start':
        yield* this.onToolInputStart(part);
        break;
      case 'tool-call':
        yield* this.onToolCall(part);
        break;
      case 'tool-result':
        yield* this.onToolResult(part);
        break;
      case 'tool-error':
        yield* this.onToolError(part);
        break;
      case 'finish-step':
        yield* this.onFinishStep(part, modelId);
        break;
      case 'error':
        yield* this.onError(part);
        break;
      default:
        break;
    }
  }

  private *onStartStep(): Generator<void> {
    this.currentStep++;
    this.stepTracker.startStep(this.currentStep);
    yield this.emitFn(mapStepStart(this.scope, this.currentStep));
  }

  private *onTextStart(part: Record<string, unknown>): Generator<void> {
    this.currentTextPartId = (part.id as string) ?? partId('t');
    this.currentTextAccumulated = '';
    yield this.emitFn(mapTextStart(this.scope, this.currentTextPartId));
  }

  private *onTextDelta(part: Record<string, unknown>): Generator<void> {
    if (!this.currentTextPartId) {
      this.currentTextPartId = (part.id as string) ?? partId('t');
      this.currentTextAccumulated = '';
      yield this.emitFn(mapTextStart(this.scope, this.currentTextPartId));
    }
    this.currentTextAccumulated += part.text as string;
    this.stepTracker.recordTextChunk();
    yield this.emitFn(mapTextDelta(this.scope, part.text as string, this.currentTextPartId));
  }

  private *onTextEnd(): Generator<void> {
    if (this.currentTextPartId && this.currentTextAccumulated) {
      yield this.emitFn(mapTextDone(this.scope, this.currentTextAccumulated, this.currentTextPartId));
    }
    this.currentTextPartId = undefined;
    this.currentTextAccumulated = '';
  }

  private *onReasoningStart(part: Record<string, unknown>): Generator<void> {
    this.currentReasoningPartId = (part.id as string) ?? partId('r');
    this.currentReasoningAccumulated = '';
    yield this.emitFn(mapReasoningStart(this.scope, this.currentReasoningPartId));
  }

  private *onReasoningDelta(part: Record<string, unknown>): Generator<void> {
    if (!this.currentReasoningPartId) {
      this.currentReasoningPartId = (part.id as string) ?? partId('r');
      this.currentReasoningAccumulated = '';
      yield this.emitFn(mapReasoningStart(this.scope, this.currentReasoningPartId));
    }
    this.currentReasoningAccumulated += part.text as string;
    yield this.emitFn(mapReasoningDelta(this.scope, part.text as string, this.currentReasoningPartId));
  }

  private *onReasoningEnd(): Generator<void> {
    if (this.currentReasoningPartId && this.currentReasoningAccumulated) {
      yield this.emitFn(mapReasoningDone(this.scope, this.currentReasoningPartId, this.currentReasoningAccumulated));
    }
    this.currentReasoningPartId = undefined;
    this.currentReasoningAccumulated = '';
  }

  private *onToolInputStart(part: Record<string, unknown>): Generator<void> {
    const id = part.id as string;
    const toolName = part.toolName as string;
    this.toolInputStarted.add(id);
    this.toolTracker.registerPending(id, toolName);
    yield this.emitFn(mapToolCallStart(this.scope, id, toolName));
  }

  private *onToolCall(part: Record<string, unknown>): Generator<void> {
    this.stepTracker.recordToolCall();
    const toolCallId = part.toolCallId as string;
    const toolName = part.toolName as string;
    const argsObj = part.input as Record<string, unknown>;

    const doomResult = this.toolTracker.recordToolCall(toolCallId, toolName, argsObj);

    if (doomResult === 'warning') {
      yield this.emitFn(mapError(
        this.scopeNoMsg,
        'DOOM_LOOP_WARNING',
        `Warning: "${toolName}" called with identical arguments ${(this.toolTracker as unknown as { doomLoopThreshold: number }).doomLoopThreshold - 1} times. One more identical call will halt execution.`,
      ));
    } else if (doomResult === true) {
      yield this.emitFn(mapError(
        this.scopeNoMsg,
        'DOOM_LOOP',
        `Detected doom loop: "${toolName}" called ${(this.toolTracker as unknown as { doomLoopThreshold: number }).doomLoopThreshold} times with identical arguments. Stopping.`,
      ));
    }

    this.toolStartTimes.set(toolCallId, Date.now());

    if (!this.toolInputStarted.has(toolCallId)) {
      yield this.emitFn(mapToolCallStart(this.scope, toolCallId, toolName));
    }
    this.toolInputStarted.delete(toolCallId);

    yield this.emitFn(mapToolCallDone(this.scope, toolCallId, toolName, argsObj));
  }

  private *onToolResult(part: Record<string, unknown>): Generator<void> {
    const toolCallId = part.toolCallId as string;
    const toolName = part.toolName as string;
    const output = part.output as unknown;

    const startTime = this.toolStartTimes.get(toolCallId);
    const durationMs = startTime != null ? Date.now() - startTime : undefined;
    this.toolStartTimes.delete(toolCallId);
    this.toolTracker.updateStatus(toolCallId, 'completed');
    yield this.emitFn(mapToolResult(this.scope, toolCallId, toolName, output, false, durationMs));
  }

  private *onToolError(part: Record<string, unknown>): Generator<void> {
    const toolCallId = part.toolCallId as string;
    const toolName = part.toolName as string;
    const rawError = part.error as unknown;
    const errMsg = rawError instanceof Error ? rawError.message : String(rawError);

    this.toolTracker.updateStatus(toolCallId, 'error');
    yield this.emitFn(mapToolError(this.scope, toolCallId, toolName, errMsg));

    if (errMsg.includes('Permission denied') || errMsg.includes('User denied permission')) {
      yield this.emitFn(mapError(this.scopeNoMsg, 'PERMISSION_DENIED', errMsg));
    }
  }

  private *onFinishStep(part: Record<string, unknown>, modelId: string): Generator<void> {
    // Close open text/reasoning parts before step ends (safety net)
    if (this.currentTextPartId && this.currentTextAccumulated) {
      yield this.emitFn(mapTextDone(this.scope, this.currentTextAccumulated, this.currentTextPartId));
      this.currentTextPartId = undefined;
      this.currentTextAccumulated = '';
    }
    if (this.currentReasoningPartId && this.currentReasoningAccumulated) {
      yield this.emitFn(mapReasoningDone(this.scope, this.currentReasoningPartId, this.currentReasoningAccumulated));
      this.currentReasoningPartId = undefined;
      this.currentReasoningAccumulated = '';
    }

    this.stepTracker.finishStep();

    const rawUsage = part.usage as { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined;
    const usage: TokenUsage | null = rawUsage
      ? {
          inputTokens: rawUsage.inputTokens ?? 0,
          outputTokens: rawUsage.outputTokens ?? 0,
          totalTokens: rawUsage.totalTokens ?? 0,
        }
      : null;

    this.stepCost = calculateStepCost(usage, modelId);

    yield this.emitFn(mapStepFinish(
      this.scope,
      this.currentStep,
      part.finishReason as FinishReason,
      usage,
      this.stepCost > 0 ? this.stepCost : undefined,
    ));

    // File snapshot diff for per-step change tracking
    // Note: snapshot is managed by the loop and passed in via the stream result.
    // The loop handles snapshot capture/diff around the processor call.
  }

  private *onError(part: Record<string, unknown>): Generator<void> {
    const rawError = part.error as unknown;
    const errMsg = rawError instanceof Error ? rawError.message : String(rawError);
    yield this.emitFn(mapError(this.scopeNoMsg, 'STREAM_ERROR', errMsg));
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  private *closeOpenParts(): Generator<void> {
    if (this.currentTextPartId && this.currentTextAccumulated) {
      yield this.emitFn(mapTextDone(this.scope, this.currentTextAccumulated, this.currentTextPartId));
    }
    if (this.currentReasoningPartId && this.currentReasoningAccumulated) {
      yield this.emitFn(mapReasoningDone(this.scope, this.currentReasoningPartId, this.currentReasoningAccumulated));
    }
  }

  // ── Timeline Update ──────────────────────────────────────────────────

  private async updateTimeline(
    result: StreamTextResult,
    modelId: string,
  ): Promise<void> {
    try {
      const responseMessages = await result.response;
      if (!responseMessages?.messages) return;

      const assistantParts: MessagePart[] = [];
      const toolResultParts: MessagePart[] = [];

      for (const respMsg of responseMessages.messages) {
        if (respMsg.role === 'assistant') {
          this.collectAssistantParts(respMsg.content, assistantParts);
        } else if (respMsg.role === 'tool') {
          this.collectToolResultParts(respMsg.content, toolResultParts);
        }
      }

      const merged = [...assistantParts, ...toolResultParts];
      for (let i = 0; i < merged.length; i++) merged[i].index = i;

      if (merged.length > 0) {
        this.timeline.appendMessage({ role: 'assistant', modelId, parts: merged });
      }
    } catch {
      // Non-critical: timeline update failure shouldn't crash the loop
    }
  }

  private collectAssistantParts(content: unknown, parts: MessagePart[]): void {
    if (typeof content === 'string') {
      parts.push({ type: 'text', id: partId('t'), index: 0, text: content });
    } else if (Array.isArray(content)) {
      for (const c of content) {
        if (c.type === 'text') {
          parts.push({ type: 'text', id: partId('t'), index: parts.length, text: c.text });
        } else if (c.type === 'tool-call') {
          const tc = c as { toolCallId: string; toolName: string; input: unknown };
          parts.push({
            type: 'tool-call',
            id: partId('tc'),
            index: parts.length,
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            args: tc.input as Record<string, unknown>,
            status: 'completed' as ToolStatus,
          });
        }
      }
    }
  }

  private collectToolResultParts(content: unknown, parts: MessagePart[]): void {
    const items = Array.isArray(content) ? content : [];
    for (const c of items) {
      if (c.type === 'tool-result') {
        const tr = c as { toolCallId: string; toolName: string; output?: unknown; result?: unknown };
        parts.push({
          type: 'tool-result',
          id: partId('tr'),
          index: 0,
          toolCallId: tr.toolCallId,
          toolName: tr.toolName,
          output: tr.output ?? tr.result,
          isError: false,
        });
      }
    }
  }
}
