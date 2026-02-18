/**
 * WorkspaceContext -- One per open directory.
 *
 * This is the top-level runtime context. Every operation in the system
 * receives a reference to this. Everything is scoped, everything is cleanable.
 */

import type { FSWatcher } from 'chokidar';
import { platform } from 'node:os';
import type { ResolvedConfig, GitState } from '@coding-assistant/shared';
import type { ProcessManager } from './process-manager.js';
import type { SessionContext } from '../session/context.js';
import type { SessionManager } from '../session/manager.js';
import type { ShellInfo } from '../shell/index.js';
import { Shell } from '../shell/index.js';

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

  /** Resolved shell for this workspace, based on config. */
  get resolvedShell(): ShellInfo {
    return Shell.resolve(this.config.shell.defaultShell) ?? Shell.preferred();
  }

  /**
   * Get additional shell environment variables for a given working directory.
   * Ensures common tool directories are in PATH when shell profiles aren't sourced.
   */
  getShellEnv(_cwd: string): Record<string, string> {
    const env: Record<string, string> = {};
    const currentPath = process.env.PATH ?? '';

    // Ensure common tool directories are included in PATH
    const extraDirs: string[] = [];
    if (platform() === 'darwin') {
      // Homebrew (Intel + ARM), common tool dirs
      extraDirs.push('/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin');
    } else if (platform() !== 'win32') {
      // Linux common tool dirs
      extraDirs.push('/usr/local/bin');
    }

    const missingDirs = extraDirs.filter((d) => !currentPath.includes(d));
    if (missingDirs.length > 0) {
      env.PATH = [...missingDirs, currentPath].join(':');
    }

    return env;
  }

  /** Cleanup everything when workspace closes */
  [Symbol.dispose](): void {
    for (const session of this.sessions.values()) {
      session[Symbol.dispose]();
    }
    this.sessions.clear();
    this.fileWatcher.close();
    this.processManager.killAllSync();
  }
}
