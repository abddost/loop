/**
 * SessionContext -- One per active session within a workspace.
 */

import type { WorkspaceContext } from '../workspace/context.js';
import { SessionStateMachine } from './state-machine.js';
import { MessageTimeline } from './timeline.js';
import { PermissionStore } from './permission-store.js';

export interface WriteLock {
  acquire(): Promise<void>;
  release(): void;
}

function createWriteLock(): WriteLock {
  let locked = false;
  const queue: (() => void)[] = [];

  return {
    acquire(): Promise<void> {
      if (!locked) {
        locked = true;
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        queue.push(resolve);
      });
    },
    release(): void {
      const next = queue.shift();
      if (next) {
        next();
      } else {
        locked = false;
      }
    },
  };
}

export class SessionContext implements Disposable {
  readonly id: string;
  readonly workspace: WorkspaceContext;
  readonly agentId: string;
  readonly state: SessionStateMachine;
  readonly timeline: MessageTimeline;
  readonly permissionStore: PermissionStore;
  readonly abortController: AbortController;
  readonly fileReadTimestamps: Map<string, number>;
  readonly writeLocks: Map<string, WriteLock>;
  readonly createdAt: string;

  constructor(params: {
    id: string;
    workspace: WorkspaceContext;
    agentId?: string;
  }) {
    this.id = params.id;
    this.workspace = params.workspace;
    this.agentId = params.agentId ?? 'build';
    this.state = new SessionStateMachine('idle');
    this.timeline = new MessageTimeline();
    this.permissionStore = new PermissionStore();
    this.abortController = new AbortController();
    this.fileReadTimestamps = new Map();
    this.writeLocks = new Map();
    this.createdAt = new Date().toISOString();
  }

  /**
   * Get or create a write lock for a file path.
   */
  getWriteLock(path: string): WriteLock {
    let lock = this.writeLocks.get(path);
    if (!lock) {
      lock = createWriteLock();
      this.writeLocks.set(path, lock);
    }
    return lock;
  }

  /**
   * Cancel any active execution.
   */
  cancel(): void {
    this.abortController.abort('user cancelled');
  }

  [Symbol.dispose](): void {
    this.abortController.abort('session disposed');
    this.writeLocks.clear();
    this.fileReadTimestamps.clear();
  }
}
