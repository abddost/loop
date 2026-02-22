/**
 * SessionContext -- One per active session within a workspace.
 */

import type { WorkspaceContext } from '../workspace/context.js';
import { SessionStateMachine } from './state-machine.js';
import { MessageTimeline } from './timeline.js';
import { Permission } from '../permissions/permission.js';

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
  private _agentId: string;
  readonly state: SessionStateMachine;
  readonly timeline: MessageTimeline;
  abortController: AbortController;
  readonly fileReadTimestamps: Map<string, number>;
  readonly writeLocks: Map<string, WriteLock>;
  readonly createdAt: string;
  /** Session title -- auto-generated from first message content. */
  title: string | null;
  /** Previous agent ID, set when switching agents (e.g. plan -> build). */
  previousAgentId: string | null = null;
  /** Tool categories denied for this session (e.g. subagents deny 'agent' to prevent recursion). */
  readonly deniedToolCategories: Set<string>;
  /** True when this session was spawned by the subagent tool (not a primary user session). */
  readonly isSubagent: boolean;
  /** Cached message count — incremented in-memory on message-appended, avoids DB queries. */
  messageCount: number = 0;
  /** Recent tool calls for doom loop detection — tracks (toolName, argsHash) tuples. */
  readonly recentToolCalls: Array<{ toolName: string; argsHash: string }> = [];

  constructor(params: {
    id: string;
    workspace: WorkspaceContext;
    agentId?: string;
    createdAt?: string;
    title?: string;
    deniedToolCategories?: string[];
    isSubagent?: boolean;
  }) {
    this.id = params.id;
    this.workspace = params.workspace;
    this._agentId = params.agentId ?? 'build';
    this.state = new SessionStateMachine('idle');
    this.timeline = new MessageTimeline();
    this.timeline.setSessionId(this.id);
    this.abortController = new AbortController();
    this.fileReadTimestamps = new Map();
    this.writeLocks = new Map();
    this.createdAt = params.createdAt ?? new Date().toISOString();
    this.title = params.title ?? null;
    this.deniedToolCategories = new Set(params.deniedToolCategories ?? []);
    this.isSubagent = params.isSubagent ?? false;
  }

  /** Current agent ID. */
  get agentId(): string {
    return this._agentId;
  }

  /**
   * Switch to a different agent, tracking the previous one
   * for plan -> build reminder injection.
   */
  switchAgent(newAgentId: string): void {
    this.previousAgentId = this._agentId;
    this._agentId = newAgentId;
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
   * Reset the abort controller for a new execution.
   * Must be called at the start of each execution so that a
   * previously-cancelled signal doesn't immediately abort the new run.
   */
  resetAbort(): void {
    this.abortController = new AbortController();
  }

  /**
   * Cancel any active execution.
   */
  cancel(): void {
    this.abortController.abort('user cancelled');
  }

  [Symbol.dispose](): void {
    this.abortController.abort('session disposed');
    this.timeline.dispose();
    this.writeLocks.clear();
    this.fileReadTimestamps.clear();
    Permission.clearApproved(this.id);
  }
}
