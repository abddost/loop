/**
 * Tracks execution steps for the current streaming run.
 */

export interface StepInfo {
  stepNumber: number;
  startedAt: number;
  finishedAt?: number;
  toolCalls: number;
  textChunks: number;
}

export class StepTracker {
  private steps: StepInfo[] = [];
  private _currentStep: StepInfo | null = null;

  get currentStep(): StepInfo | null {
    return this._currentStep;
  }

  get totalSteps(): number {
    return this.steps.length;
  }

  startStep(stepNumber: number): StepInfo {
    const step: StepInfo = {
      stepNumber,
      startedAt: Date.now(),
      toolCalls: 0,
      textChunks: 0,
    };
    this._currentStep = step;
    this.steps.push(step);
    return step;
  }

  finishStep(): StepInfo | null {
    if (this._currentStep) {
      this._currentStep.finishedAt = Date.now();
      const finished = this._currentStep;
      this._currentStep = null;
      return finished;
    }
    return null;
  }

  recordToolCall(): void {
    if (this._currentStep) {
      this._currentStep.toolCalls++;
    }
  }

  recordTextChunk(): void {
    if (this._currentStep) {
      this._currentStep.textChunks++;
    }
  }

  getSteps(): readonly StepInfo[] {
    return this.steps;
  }
}
