/**
 * Stop condition helpers for the execution loop.
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
