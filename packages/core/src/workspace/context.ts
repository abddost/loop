/**
 * WorkspaceContext -- One per open directory.
 *
 * This is the top-level runtime context. Every operation in the system
 * receives a reference to this. Everything is scoped, everything is cleanable.
 */

import type { FSWatcher } from 'chokidar';
import type { ResolvedConfig, GitState } from '@coding-assistant/shared';
import type { ProcessManager } from './process-manager.js';
import type { SessionContext } from '../session/context.js';
import type { SessionManager } from '../session/manager.js';

export class WorkspaceContext implements Disposable {
  readonly id: string;
  readonly rootPath: string;
  readonly name: string;
  config: ResolvedConfig;
  readonly agentInstructions: string[];
  gitState: GitState;
  readonly fileWatcher: FSWatcher;
  readonly processManager: ProcessManager;
  readonly sessions: Map<string, SessionContext> = new Map();
  readonly createdAt: string;
  /** Optional SessionManager for subagent session persistence. Set by the server after creation. */
  sessionManager?: SessionManager;

  constructor(params: {
    id: string;
    rootPath: string;
    name?: string;
    config: ResolvedConfig;
    agentInstructions: string[];
    gitState: GitState;
    fileWatcher: FSWatcher;
    processManager: ProcessManager;
  }) {
    this.id = params.id;
    this.rootPath = params.rootPath;
    this.name = params.name ?? params.rootPath.split('/').pop() ?? 'workspace';
    this.config = params.config;
    this.agentInstructions = params.agentInstructions;
    this.gitState = params.gitState;
    this.fileWatcher = params.fileWatcher;
    this.processManager = params.processManager;
    this.createdAt = new Date().toISOString();
  }

  /** Cleanup everything when workspace closes */
  [Symbol.dispose](): void {
    for (const session of this.sessions.values()) {
      session[Symbol.dispose]();
    }
    this.sessions.clear();
    this.fileWatcher.close();
    this.processManager.killAll();
  }
}
