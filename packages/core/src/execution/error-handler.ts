/**
 * Error Handler -- classifies and handles execution errors.
 */

import type { FinishReason } from '@coding-assistant/shared';
import type { SessionContext } from '../session/context.js';
import type { StepScope } from './types.js';
import type { RawStreamEvent } from './stream-mapper.js';
import {
  classifyRetryable,
  calculateRetryDelay,
  retrySleep,
  DEFAULT_RETRY_CONFIG,
} from './retry.js';
import {
  mapError,
  mapMessageDone,
  mapSessionStatus,
} from './stream-mapper.js';

export interface ErrorResult {
  action: 'break' | 'continue';
  retryAttempt: number;
}

/**
 * Handle an execution error from the step loop.
 * Emits error/retry events and returns whether the loop should break or continue.
 */
export async function handleExecutionError(
  error: unknown,
  session: SessionContext,
  scope: StepScope,
  scopeNoMsg: { workspaceId: string; sessionId: string },
  retryAttempt: number,
  lastModelId: string,
  emitFn: (raw: RawStreamEvent) => void,
): Promise<ErrorResult> {
  // Abort (user cancellation)
  if (error instanceof DOMException && error.name === 'AbortError') {
    emitFn(mapError(scopeNoMsg, 'ABORTED', 'Execution was cancelled'));
    emitFn(mapMessageDone(scope, 'stop' as FinishReason, null, lastModelId));
    return { action: 'break', retryAttempt };
  }

  // Retryable transient error
  const retryReason = classifyRetryable(error);
  if (retryReason && retryAttempt < DEFAULT_RETRY_CONFIG.maxAttempts) {
    const nextAttempt = retryAttempt + 1;
    const delay = calculateRetryDelay(nextAttempt, error);
    const nextAt = Date.now() + delay;

    session.state.transition('retry');
    emitFn(mapSessionStatus(scopeNoMsg, 'retry', {
      attempt: nextAttempt,
      reason: retryReason,
      nextAt,
    }));

    const completed = await retrySleep(delay, session.abortController.signal);
    if (!completed) {
      emitFn(mapError(scopeNoMsg, 'ABORTED', 'Execution was cancelled during retry'));
      emitFn(mapMessageDone(scope, 'stop' as FinishReason, null, lastModelId));
      return { action: 'break', retryAttempt: nextAttempt };
    }

    session.state.transition('busy');
    emitFn(mapSessionStatus(scopeNoMsg, 'busy'));
    emitFn(mapMessageDone(scope, 'error' as FinishReason, null, lastModelId));
    return { action: 'continue', retryAttempt: nextAttempt };
  }

  // Non-retryable error
  emitFn(mapError(
    scopeNoMsg,
    'EXECUTION_ERROR',
    error instanceof Error ? error.message : 'Unknown error',
  ));
  emitFn(mapMessageDone(scope, 'error' as FinishReason, null, lastModelId));
  return { action: 'break', retryAttempt };
}
