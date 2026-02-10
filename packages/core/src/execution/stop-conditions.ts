/**
 * Stop condition helpers for the execution loop.
 *
 * NOTE: These are not currently called by loop.ts because the AI SDK's
 * `maxSteps` param handles step limits, and abort is handled via AbortController.
 * Kept for future use when custom stop conditions (token budget, time limits)
 * are added to the execution loop.
 */

export interface StopConditionParams {
  stepCount: number;
  maxSteps: number;
  totalTokens: number;
  maxTokens: number;
  aborted: boolean;
}

export function shouldStop(params: StopConditionParams): { stop: boolean; reason: string } {
  if (params.aborted) {
    return { stop: true, reason: 'aborted' };
  }

  if (params.stepCount >= params.maxSteps) {
    return { stop: true, reason: `max steps reached (${params.maxSteps})` };
  }

  if (params.maxTokens > 0 && params.totalTokens >= params.maxTokens) {
    return { stop: true, reason: `token budget exhausted (${params.maxTokens})` };
  }

  return { stop: false, reason: '' };
}
