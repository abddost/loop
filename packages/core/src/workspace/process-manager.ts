/**
 * Process manager -- tracks all spawned child processes for a workspace.
 * Now with process group support and proper tree killing.
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { platform } from 'node:os';
import { Shell } from '../shell/index.js';

export interface ProcessEntry {
  pid: number;
  child: ChildProcess;
  command: string;
  startedAt: number;
  isGroupLeader: boolean;
}

export class ProcessManager {
  private processes = new Map<number, ProcessEntry>();

  /**
   * Spawn a tracked child process.
   *
   * On non-Windows platforms the process is spawned with `detached: true`
   * so it becomes a process group leader, enabling tree-killing via
   * `Shell.killTree()`.
   */
  spawn(command: string, args: string[], options?: SpawnOptions): ChildProcess {
    const isWindows = platform() === 'win32';

    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(!isWindows && { detached: true }),
      ...options,
    });

    if (child.pid) {
      const entry: ProcessEntry = {
        pid: child.pid,
        child,
        command: [command, ...args].join(' '),
        startedAt: Date.now(),
        isGroupLeader: !isWindows,
      };

      this.processes.set(child.pid, entry);

      child.on('exit', () => {
        if (child.pid) {
          this.processes.delete(child.pid);
        }
      });
    }

    return child;
  }

  /**
   * Register an externally spawned child process for tracking.
   * Use this when a tool spawns its own process but needs cleanup tracking.
   */
  register(child: ChildProcess, command: string): void {
    if (!child.pid) return;
    const entry: ProcessEntry = {
      pid: child.pid,
      child,
      command,
      startedAt: Date.now(),
      isGroupLeader: platform() !== 'win32',
    };
    this.processes.set(child.pid, entry);
    child.on('exit', () => {
      if (child.pid) this.processes.delete(child.pid);
    });
  }

  /**
   * Kill a specific process by PID.
   */
  kill(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
    const entry = this.processes.get(pid);
    if (entry) {
      entry.child.kill(signal);
      this.processes.delete(pid);
      return true;
    }
    return false;
  }

  /**
   * Kill a process and its entire tree via `Shell.killTree()`.
   */
  async killTree(pid: number): Promise<boolean> {
    const entry = this.processes.get(pid);
    if (!entry) return false;

    await Shell.killTree(entry.child);
    this.processes.delete(pid);
    return true;
  }

  /**
   * Kill all tracked processes using tree-killing.
   * Returns once every kill has settled.
   */
  async killAll(): Promise<void> {
    const entries = [...this.processes.values()];
    this.processes.clear();

    await Promise.allSettled(
      entries.map((entry) => Shell.killTree(entry.child)),
    );
  }

  /**
   * Synchronous fallback for killing all tracked processes.
   * Uses direct SIGTERM without tree-killing -- suitable for
   * synchronous `Symbol.dispose` contexts.
   */
  killAllSync(signal: NodeJS.Signals = 'SIGTERM'): void {
    for (const [, entry] of this.processes) {
      try {
        entry.child.kill(signal);
      } catch {
        // Process may have already exited
      }
    }
    this.processes.clear();
  }

  /**
   * List tracked processes for diagnostics.
   */
  list(): Array<{ pid: number; command: string; startedAt: number; isGroupLeader: boolean }> {
    return [...this.processes.values()].map(({ pid, command, startedAt, isGroupLeader }) => ({
      pid,
      command,
      startedAt,
      isGroupLeader,
    }));
  }

  /**
   * Number of currently tracked processes.
   */
  get size(): number {
    return this.processes.size;
  }
}
