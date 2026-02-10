/**
 * Process manager -- tracks all spawned child processes for a workspace.
 * Kills all on dispose.
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';

export class ProcessManager {
  private processes = new Map<number, ChildProcess>();

  /**
   * Spawn a tracked child process.
   */
  spawn(command: string, args: string[], options?: SpawnOptions): ChildProcess {
    const child = spawn(command, args, {
      stdio: 'pipe',
      ...options,
    });

    if (child.pid) {
      this.processes.set(child.pid, child);

      child.on('exit', () => {
        if (child.pid) {
          this.processes.delete(child.pid);
        }
      });
    }

    return child;
  }

  /**
   * Kill a specific process by PID.
   */
  kill(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
    const child = this.processes.get(pid);
    if (child) {
      child.kill(signal);
      this.processes.delete(pid);
      return true;
    }
    return false;
  }

  /**
   * Kill all tracked processes -- called on workspace dispose.
   */
  killAll(signal: NodeJS.Signals = 'SIGTERM'): void {
    for (const [pid, child] of this.processes) {
      try {
        child.kill(signal);
      } catch {
        // Process may have already exited
      }
      this.processes.delete(pid);
    }
  }

  /**
   * Number of currently tracked processes.
   */
  get size(): number {
    return this.processes.size;
  }
}
