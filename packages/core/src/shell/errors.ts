/**
 * Bash error classification -- maps raw process exit info to structured error kinds.
 */

export type BashErrorKind =
  | 'completed'
  | 'timeout'
  | 'abort'
  | 'permission_denied'
  | 'command_not_found'
  | 'spawn_error'
  | 'shell_not_found'
  | 'cwd_not_found'
  | 'boundary_violation'
  | 'killed';

export interface BashExitInfo {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  aborted: boolean;
  spawnError?: string;
}

/**
 * Classify a process exit into a structured error kind.
 *
 * Standard Unix exit codes:
 * - 0: success
 * - 124: timeout (GNU coreutils convention)
 * - 126: command found but not executable (permission denied)
 * - 127: command not found
 * - 128+N: killed by signal N (e.g. 130 = SIGINT, 137 = SIGKILL, 143 = SIGTERM)
 */
export function classifyExitError(info: BashExitInfo): BashErrorKind {
  if (info.spawnError) {
    if (info.spawnError.includes('ENOENT')) {
      return info.exitCode === null ? 'shell_not_found' : 'command_not_found';
    }
    if (info.spawnError.includes('EACCES')) return 'permission_denied';
    return 'spawn_error';
  }

  if (info.timedOut) return 'timeout';
  if (info.aborted) return 'abort';

  if (info.signal === 'SIGKILL') return 'killed';
  if (info.signal === 'SIGTERM' || info.signal === 'SIGINT') return 'abort';

  if (info.exitCode === 126) return 'permission_denied';
  if (info.exitCode === 127) return 'command_not_found';

  return 'completed';
}

const errorMessages: Record<BashErrorKind, string> = {
  completed: 'Process completed',
  timeout: 'Process timed out',
  abort: 'Process was aborted',
  killed: 'Process was forcefully killed',
  permission_denied: 'Permission denied',
  command_not_found: 'Command not found',
  spawn_error: 'Failed to spawn process',
  shell_not_found: 'Shell executable not found',
  cwd_not_found: 'Working directory not found',
  boundary_violation: 'Command violates security boundary',
};

/**
 * Get a human-readable message for an error kind.
 */
export function errorKindMessage(kind: BashErrorKind): string {
  return errorMessages[kind];
}

const exitCodes: Record<BashErrorKind, number> = {
  completed: 0,
  timeout: 124,
  abort: 130,
  killed: 137,
  permission_denied: 126,
  command_not_found: 127,
  spawn_error: 71,
  shell_not_found: 127,
  cwd_not_found: 1,
  boundary_violation: 77,
};

/**
 * Map exit reason to a semantic exit code for the tool result.
 */
export function semanticExitCode(kind: BashErrorKind): number {
  return exitCodes[kind];
}
