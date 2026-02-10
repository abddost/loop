/**
 * Session state machine: idle -> busy -> retry -> idle
 */

import type { SessionStatus } from '@coding-assistant/shared';

type StateTransition = {
  from: SessionStatus[];
  to: SessionStatus;
};

const validTransitions: StateTransition[] = [
  { from: ['idle'], to: 'busy' },
  { from: ['busy'], to: 'idle' },
  { from: ['busy'], to: 'retry' },
  { from: ['busy'], to: 'error' },
  { from: ['retry'], to: 'busy' },
  { from: ['retry'], to: 'idle' },
  { from: ['error'], to: 'idle' },
  { from: ['error'], to: 'busy' },
];

export class SessionStateMachine {
  private _status: SessionStatus;
  private listeners = new Set<(status: SessionStatus) => void>();

  constructor(initial: SessionStatus = 'idle') {
    this._status = initial;
  }

  get status(): SessionStatus {
    return this._status;
  }

  transition(to: SessionStatus): void {
    const valid = validTransitions.some(
      (t) => t.from.includes(this._status) && t.to === to,
    );

    if (!valid) {
      throw new Error(
        `Invalid session state transition: ${this._status} -> ${to}`,
      );
    }

    this._status = to;
    for (const listener of this.listeners) {
      listener(to);
    }
  }

  onTransition(callback: (status: SessionStatus) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
}
