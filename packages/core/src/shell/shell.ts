/**
 * Shell management -- platform-aware shell detection and process tree killing.
 */

import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ShellInfo {
  path: string;
  name: string;
  args: (cmd: string) => string[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const BLACKLISTED_SHELLS = new Set([
  'fish',
  'nu',
  'nushell',
  'xonsh',
  'elvish',
]);

/** Grace period before escalating SIGTERM to SIGKILL (ms). */
const KILL_GRACE_MS = 200;

/* ------------------------------------------------------------------ */
/*  Shell builders                                                     */
/* ------------------------------------------------------------------ */

function unixShell(shellPath: string): ShellInfo {
  const name = shellPath.split('/').pop() ?? shellPath;
  return {
    path: shellPath,
    name,
    args: (cmd) => ['-c', cmd],
  };
}

function cmdExe(): ShellInfo {
  return {
    path: 'cmd.exe',
    name: 'cmd',
    args: (cmd) => ['/c', cmd],
  };
}

/* ------------------------------------------------------------------ */
/*  Git Bash detection (Windows)                                       */
/* ------------------------------------------------------------------ */

function findGitBash(): string | null {
  const candidates = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Shell class                                                        */
/* ------------------------------------------------------------------ */

let _preferred: ShellInfo | undefined;

export const Shell = {
  /**
   * Returns the preferred shell for the current platform (lazy singleton).
   *
   * - macOS (`darwin`): `/bin/zsh` (default since Catalina)
   * - Linux: `/bin/bash` -> `/bin/sh` fallback
   * - Windows (`win32`): Git Bash -> `cmd.exe` fallback
   */
  preferred(): ShellInfo {
    if (_preferred) {
      console.log('[shell] preferred (cached):', { path: _preferred.path, name: _preferred.name });
      return _preferred;
    }

    const os = platform();

    // Check $SHELL first (user's configured shell has their PATH, shims, etc.)
    if (os !== 'win32') {
      const envShell = process.env.SHELL;
      console.log('[shell] checking $SHELL:', { envShell, exists: envShell ? existsSync(envShell) : false });
      if (envShell && existsSync(envShell)) {
        const name = envShell.split('/').pop() ?? envShell;
        const base = name.replace(/\.exe$/i, '').toLowerCase();
        if (!BLACKLISTED_SHELLS.has(base)) {
          _preferred = unixShell(envShell);
          console.log('[shell] preferred: using $SHELL:', { path: _preferred.path });
          return _preferred;
        }
        console.log('[shell] $SHELL blacklisted:', { base });
      }
    }

    if (os === 'darwin') {
      _preferred = unixShell('/bin/zsh');
    } else if (os === 'win32') {
      const gitBash = findGitBash();
      _preferred = gitBash ? unixShell(gitBash) : cmdExe();
    } else {
      // Linux / other Unix
      _preferred = existsSync('/bin/bash')
        ? unixShell('/bin/bash')
        : unixShell('/bin/sh');
    }

    console.log('[shell] preferred (platform fallback):', { path: _preferred.path, name: _preferred.name });
    return _preferred;
  },

  /**
   * Safe fallback shell that is guaranteed to exist on each platform.
   */
  acceptable(): ShellInfo {
    if (platform() === 'win32') return cmdExe();

    // Prefer $SHELL if available and not blacklisted
    const envShell = process.env.SHELL;
    if (envShell && existsSync(envShell)) {
      const name = envShell.split('/').pop() ?? envShell;
      const base = name.replace(/\.exe$/i, '').toLowerCase();
      if (!BLACKLISTED_SHELLS.has(base)) return unixShell(envShell);
    }

    return unixShell('/bin/sh');
  },

  /**
   * Validate a user-configured shell path.
   *
   * Returns `ShellInfo` when the path exists and is not blacklisted,
   * or `null` otherwise.
   */
  resolve(path: string): ShellInfo | null {
    console.log('[shell] resolve called:', { path, exists: existsSync(path) });
    if (!existsSync(path)) return null;

    const name = path.split(/[/\\]/).pop() ?? path;
    const base = name.replace(/\.exe$/i, '').toLowerCase();

    if (BLACKLISTED_SHELLS.has(base)) {
      console.log('[shell] resolve: blacklisted:', { base });
      return null;
    }

    // Treat cmd.exe specially for arg style
    if (base === 'cmd') return cmdExe();

    const result = unixShell(path);
    console.log('[shell] resolve result:', { path: result.path, name: result.name });
    return result;
  },

  /**
   * Kill a child process and its entire process tree.
   *
   * - Unix: sends SIGTERM to the process group (negative PID), waits
   *   `KILL_GRACE_MS`, then escalates to SIGKILL. Falls back to direct
   *   `child.kill()` if the group kill throws.
   * - Windows: uses `taskkill /pid <pid> /f /t`.
   */
  async killTree(child: ChildProcess, opts?: { exited?: () => boolean }): Promise<void> {
    const pid = child.pid;
    if (pid === undefined) return;

    // Skip if the process already exited
    if (opts?.exited?.()) return;

    if (platform() === 'win32') {
      try {
        // Async spawn instead of blocking execSync
        await new Promise<void>((resolve) => {
          const tk = spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { stdio: 'ignore' });
          tk.on('close', () => resolve());
          tk.on('error', () => resolve());
        });
      } catch {
        // Process may have already exited
      }
      return;
    }

    // Unix -- try process-group kill first
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // Group kill failed (e.g. not a group leader) -- fall back to direct
      child.kill('SIGTERM');
      return;
    }

    // Wait grace period, then escalate if still running
    await new Promise<void>((resolve) => setTimeout(resolve, KILL_GRACE_MS));

    // Check again if exited during grace period
    if (opts?.exited?.()) return;

    try {
      // Signal 0 checks existence without sending a real signal
      process.kill(-pid, 0);
      // Still alive -- escalate
      process.kill(-pid, 'SIGKILL');
    } catch {
      // Already exited -- nothing to do
    }
  },

  /** Reset the cached preferred shell (useful for testing). */
  _resetCache(): void {
    _preferred = undefined;
  },
} as const;
