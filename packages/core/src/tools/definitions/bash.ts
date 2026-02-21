/**
 * bash tool -- executes shell commands in the workspace.
 *
 * Uses the Shell module for platform-aware shell selection,
 * Shell.killTree() for process tree termination, and the
 * truncation system for large output management.
 */

import { z } from 'zod';
import { spawn } from 'node:child_process';
import { join, isAbsolute, dirname } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { platform } from 'node:os';
import type { ToolDefinition } from '../types.js';
import { assertExternalDirectory, containsPath } from '../assert-external-directory.js';
import { extractCommands } from '../../permissions/matchers/bash-ast.js';
import { normalizeToPattern } from '../../permissions/matchers/command-arity.js';
import { Shell } from '../../shell/index.js';
import { truncateOutput } from '../../shell/truncation.js';
import { classifyExitError, semanticExitCode, type BashErrorKind } from '../../shell/errors.js';
import type { ShellConfig } from '@coding-assistant/shared';

/* ------------------------------------------------------------------ */
/*  Schema                                                             */
/* ------------------------------------------------------------------ */

const inputSchema = z.object({
  command: z.string().describe('The shell command to execute'),
  working_directory: z
    .string()
    .optional()
    .describe('Working directory (relative to workspace root)'),
  timeout: z
    .number()
    .optional()
    .describe('Timeout in milliseconds (overrides config)'),
  description: z
    .string()
    .optional()
    .describe('Brief description of what this command does'),
  env: z
    .record(z.string())
    .optional()
    .describe('Additional environment variables'),
  run_in_background: z
    .boolean()
    .optional()
    .describe('Run the command in the background without waiting'),
});

type Input = z.infer<typeof inputSchema>;

/* ------------------------------------------------------------------ */
/*  Result                                                             */
/* ------------------------------------------------------------------ */

type ExitReason = 'completed' | 'timeout' | 'abort' | 'killed' | 'error';

interface BashResult {
  stdout: string;
  stderr: string;
  /** Combined stdout+stderr in chronological order */
  output: string;
  exitCode: number;
  exitReason: ExitReason;
  description?: string;
  pid?: number;
  truncatedOutputPath?: string;
}

function toExitReason(kind: BashErrorKind): ExitReason {
  switch (kind) {
    case 'timeout':
      return 'timeout';
    case 'abort':
      return 'abort';
    case 'killed':
      return 'killed';
    case 'completed':
      return 'completed';
    default:
      return 'error';
  }
}

/* ------------------------------------------------------------------ */
/*  External directory detection for command arguments                  */
/* ------------------------------------------------------------------ */

const FILE_COMMANDS = new Set([
  'cd', 'rm', 'cp', 'mv', 'mkdir', 'touch', 'chmod', 'chown', 'cat',
  'rmdir', 'ln', 'scp', 'rsync',
]);

/* ------------------------------------------------------------------ */
/*  Tool definition                                                    */
/* ------------------------------------------------------------------ */

export const definition: ToolDefinition<Input, BashResult> = {
  name: 'bash',
  description: 'Execute a shell command in the workspace',
  inputSchema,
  category: 'shell',
  riskLevel: 'dangerous',

  async execute(input, ctx) {
    const shellConfig = (ctx.config as { shell?: ShellConfig }).shell;

    // Resolve shell
    const shell =
      Shell.resolve(shellConfig?.defaultShell ?? '') ?? Shell.preferred();

    // Resolve working directory and check permissions
    const cwd = input.working_directory
      ? isAbsolute(input.working_directory)
        ? input.working_directory
        : join(ctx.workspaceRootPath, input.working_directory)
      : ctx.workspaceRootPath;

    // Check if CWD is outside workspace
    await assertExternalDirectory(ctx, cwd, { kind: 'directory' });

    // Extract command patterns and request permission
    const commands = extractCommands(input.command);

    // Gap 2: Check per-command arguments for external directory access
    const externalDirs = new Set<string>();
    for (const cmd of commands) {
      if (FILE_COMMANDS.has(cmd.name)) {
        for (const arg of cmd.args) {
          if (arg.startsWith('-')) continue;
          const resolved = isAbsolute(arg) ? arg : join(cwd, arg);
          if (!containsPath(ctx.workspaceRootPath, resolved)) {
            const stat = statSync(resolved, { throwIfNoEntry: false });
            const dir = stat?.isDirectory() ? resolved : dirname(resolved);
            externalDirs.add(dir);
          }
        }
      }
    }

    if (externalDirs.size > 0) {
      const globs = [...externalDirs].map((d) => join(d, '*'));
      await ctx.ask({
        permission: 'external_directory',
        patterns: globs,
        always: globs,
        metadata: { toolName: 'bash', command: input.command },
      });
    }

    // Gap 1: Use arity-based patterns for "always" instead of '*'
    const patterns: string[] = [];
    const always: string[] = [];
    for (const cmd of commands) {
      patterns.push(cmd.raw);
      always.push(normalizeToPattern(cmd.raw));
    }
    if (patterns.length === 0) {
      patterns.push(input.command);
      always.push(normalizeToPattern(input.command));
    }

    await ctx.ask({
      permission: 'bash',
      patterns,
      always,
      metadata: { toolName: 'bash', command: input.command, cwd },
    });

    // Validate CWD exists and is a directory
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      return {
        result: {
          stdout: '',
          stderr: `Working directory does not exist: ${cwd}`,
          output: `Working directory does not exist: ${cwd}`,
          exitCode: 1,
          exitReason: 'error',
          description: input.description,
        },
        metadata: {
          shell: shell.name,
          timeout: 0,
          cwd,
          truncated: false,
          exitReason: 'error',
          errorKind: 'cwd_not_found',
        },
      };
    }

    // Resolve timeout
    const timeout = input.timeout ?? shellConfig?.timeout ?? 120_000;

    const isUnix = platform() !== 'win32';
    const shellArgs = shell.args(input.command);

    // Build environment
    const env = {
      ...process.env,
      ...(ctx.getShellEnv?.(cwd) ?? {}),
      ...input.env,
    };

    // Pre-abort check: avoid spawning a process just to immediately kill it
    if (ctx.abort.aborted) {
      return {
        result: {
          stdout: '',
          stderr: 'Execution cancelled before command started',
          output: 'Execution cancelled before command started',
          exitCode: 130,
          exitReason: 'abort',
          description: input.description,
        },
        metadata: {
          shell: shell.name,
          timeout,
          cwd,
          truncated: false,
          exitReason: 'abort',
        },
      };
    }

    const child = spawn(shell.path, shellArgs, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: isUnix,
      env,
    });

    const pid = child.pid;

    // Register with ProcessManager for cleanup tracking on workspace shutdown
    ctx.processRegister?.(child, input.command);

    // Background mode -- return immediately with PID
    if (input.run_in_background) {
      // Unref so the child doesn't keep the parent alive
      child.unref();
      child.stdout?.destroy();
      child.stderr?.destroy();

      return {
        result: {
          stdout: '',
          stderr: '',
          output: '',
          exitCode: 0,
          exitReason: 'completed',
          description: input.description,
          pid,
        },
        metadata: {
          shell: shell.name,
          timeout,
          cwd,
          truncated: false,
          exitReason: 'completed',
          background: true,
        },
      };
    }

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let combined = '';
      let timedOut = false;
      let aborted = false;
      let exited = false;
      let stdoutBytes = 0;
      let stderrBytes = 0;

      const exitedFn = () => exited;

      const timer = setTimeout(() => {
        timedOut = true;
        void Shell.killTree(child, { exited: exitedFn }).catch(() => { child.kill('SIGKILL'); });
      }, timeout + 100); // +100ms buffer to avoid race with natural exit

      // Handle abort signal
      const abortHandler = () => {
        aborted = true;
        clearTimeout(timer);
        void Shell.killTree(child, { exited: exitedFn }).catch(() => { child.kill('SIGKILL'); });
      };
      ctx.abort.addEventListener('abort', abortHandler, { once: true });

      const MAX_METADATA_BYTES = 30_000;
      let metadataBytesSent = 0;

      child.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        combined += chunk;
        stdoutBytes += data.length;

        // Emit real-time streaming metadata (capped at 30KB to prevent event flooding)
        if (ctx.emitMetadata && ctx.toolCallId && ctx.messageId && metadataBytesSent < MAX_METADATA_BYTES) {
          const remaining = MAX_METADATA_BYTES - metadataBytesSent;
          const emitChunk = data.length <= remaining ? chunk : chunk.slice(0, remaining);
          metadataBytesSent += Buffer.byteLength(emitChunk);
          ctx.emitMetadata({
            type: 'bash-output',
            toolCallId: ctx.toolCallId,
            messageId: ctx.messageId,
            chunk: emitChunk,
            stream: 'stdout',
            totalBytes: stdoutBytes,
          });
        }
      });

      child.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        combined += chunk;
        stderrBytes += data.length;

        if (ctx.emitMetadata && ctx.toolCallId && ctx.messageId && metadataBytesSent < MAX_METADATA_BYTES) {
          const remaining = MAX_METADATA_BYTES - metadataBytesSent;
          const emitChunk = data.length <= remaining ? chunk : chunk.slice(0, remaining);
          metadataBytesSent += Buffer.byteLength(emitChunk);
          ctx.emitMetadata({
            type: 'bash-output',
            toolCallId: ctx.toolCallId,
            messageId: ctx.messageId,
            chunk: emitChunk,
            stream: 'stderr',
            totalBytes: stderrBytes,
          });
        }
      });

      child.on('close', (code, signal) => {
        exited = true;
        clearTimeout(timer);
        ctx.abort.removeEventListener('abort', abortHandler);

        // Classify the exit
        const errorKind = classifyExitError({
          exitCode: code,
          signal: signal as string | null,
          timedOut,
          aborted,
        });

        const exitReason = toExitReason(errorKind);
        const exitCode = code ?? semanticExitCode(errorKind);

        // Build bash_metadata block for AI context (timeout/abort conditions)
        const resultMetadata: string[] = [];
        if (timedOut) {
          resultMetadata.push(`Command timed out after ${timeout}ms`);
        }
        if (aborted) {
          resultMetadata.push('Command was aborted by user');
        }

        // Append metadata to combined output before truncation
        if (resultMetadata.length > 0) {
          combined += `\n\n<bash_metadata>\n${resultMetadata.join('\n')}\n</bash_metadata>`;
        }

        // Truncate output
        const stdoutResult = truncateOutput(stdout);
        const stderrResult = truncateOutput(stderr);
        const combinedResult = truncateOutput(combined);

        let resultStdout = stdoutResult.content;
        let resultStderr = stderrResult.content;

        // Append hints for truncated output
        if (stdoutResult.hint) {
          resultStdout += `\n${stdoutResult.hint}`;
        }
        if (stderrResult.hint) {
          resultStderr += `\n${stderrResult.hint}`;
        }

        let resultOutput = combinedResult.content;
        if (combinedResult.hint) {
          resultOutput += `\n${combinedResult.hint}`;
        }

        resolve({
          result: {
            stdout: resultStdout,
            stderr: resultStderr,
            output: resultOutput,
            exitCode,
            exitReason,
            description: input.description,
            pid,
            truncatedOutputPath: stdoutResult.fullOutputPath ?? stderrResult.fullOutputPath,
          },
          metadata: {
            shell: shell.name,
            timeout,
            cwd,
            truncated: stdoutResult.wasTruncated || stderrResult.wasTruncated || combinedResult.wasTruncated,
            exitReason,
          },
        });
      });

      child.on('error', (err) => {
        exited = true;
        clearTimeout(timer);
        ctx.abort.removeEventListener('abort', abortHandler);

        const errorKind = classifyExitError({
          exitCode: null,
          signal: null,
          timedOut,
          aborted,
          spawnError: err.message,
        });

        resolve({
          result: {
            stdout: '',
            stderr: err.message,
            output: err.message,
            exitCode: semanticExitCode(errorKind),
            exitReason: 'error',
            description: input.description,
          },
          metadata: {
            shell: shell.name,
            timeout,
            cwd,
            truncated: false,
            exitReason: 'error',
          },
        });
      });
    });
  },
};
