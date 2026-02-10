/**
 * Streaming Execution Loop -- the core engine.
 *
 * Receives the full context chain. Does not resolve context itself.
 * The caller provides WorkspaceContext + SessionContext.
 */

import type {
  StreamEvent,
  TokenUsage,
  FinishReason,
} from '@coding-assistant/shared';
import { generateMessageId } from '@coding-assistant/shared';
import type { WorkspaceContext } from '../workspace/context.js';
import type { SessionContext } from '../session/context.js';
import { globalEventBus } from '../events/bus.js';
import { StepTracker } from './step-tracker.js';

export interface ExecutionInput {
  /** User message text */
  content: string;
  /** Optional attachments */
  attachments?: Array<{ type: string; data: string }>;
}

/**
 * Map a stream part to a StreamEvent.
 */
function createEvent(
  type: StreamEvent['type'],
  workspaceId: string,
  sessionId: string,
  data: Record<string, unknown>,
): Omit<StreamEvent, 'globalSeq'> {
  return {
    type,
    workspaceId,
    sessionId,
    timestamp: new Date().toISOString(),
    ...data,
  } as Omit<StreamEvent, 'globalSeq'>;
}

/**
 * The main execution loop generator.
 *
 * In a full implementation, this integrates with the AI SDK's streamText().
 * For the foundation, this provides the event infrastructure.
 */
export async function* executeStream(
  workspace: WorkspaceContext,
  session: SessionContext,
  input: ExecutionInput,
): AsyncGenerator<StreamEvent> {
  const stepTracker = new StepTracker();
  const messageId = generateMessageId();

  // Transition to busy
  session.state.transition('busy');

  // Emit session status change
  const statusEvent = globalEventBus.emit(
    createEvent('session-status', workspace.id, session.id, {
      status: 'busy',
    }),
  );
  yield statusEvent;

  // Emit message start
  const msgStartEvent = globalEventBus.emit(
    createEvent('message-start', workspace.id, session.id, {
      messageId,
      role: 'assistant',
    }),
  );
  yield msgStartEvent;

  try {
    // Step tracking
    const step = stepTracker.startStep(1);

    const stepStartEvent = globalEventBus.emit(
      createEvent('step-start', workspace.id, session.id, {
        stepNumber: step.stepNumber,
      }),
    );
    yield stepStartEvent;

    // In the full implementation, this is where streamText() runs.
    // The AI SDK integration happens here:
    //
    // const result = streamText({
    //   model,
    //   system,
    //   messages,
    //   tools,
    //   abortSignal: session.abortController.signal,
    //   stopWhen: stepCountIs(agent.maxSteps ?? 25),
    // });
    //
    // for await (const part of result.fullStream) {
    //   ...map to events and yield...
    // }

    // Check abort signal
    session.abortController.signal.throwIfAborted();

    // Placeholder: emit a text-done event
    const usage: TokenUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    stepTracker.finishStep();

    const stepFinishEvent = globalEventBus.emit(
      createEvent('step-finish', workspace.id, session.id, {
        stepNumber: 1,
        finishReason: 'stop' as FinishReason,
        usage,
      }),
    );
    yield stepFinishEvent;

    // Emit message done
    const msgDoneEvent = globalEventBus.emit(
      createEvent('message-done', workspace.id, session.id, {
        messageId,
        finishReason: 'stop' as FinishReason,
        usage,
      }),
    );
    yield msgDoneEvent;

    // Transition back to idle
    session.state.transition('idle');

    const idleEvent = globalEventBus.emit(
      createEvent('session-status', workspace.id, session.id, {
        status: 'idle',
      }),
    );
    yield idleEvent;
  } catch (error) {
    // Handle abort
    if (error instanceof DOMException && error.name === 'AbortError') {
      session.state.transition('idle');
      const abortEvent = globalEventBus.emit(
        createEvent('error', workspace.id, session.id, {
          code: 'ABORTED',
          message: 'Execution was cancelled',
        }),
      );
      yield abortEvent;
      return;
    }

    // Handle other errors
    session.state.transition('error');
    const errorEvent = globalEventBus.emit(
      createEvent('error', workspace.id, session.id, {
        code: 'EXECUTION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    );
    yield errorEvent;
  }
}
