/**
 * bash tool -- executes shell commands in the workspace.
 *
 * Uses the Shell module for platform-aware shell selection,
 * Shell.killTree() for process tree termination, and the
 * truncation system for large output management.
 */

import { z } from 'zod';
import { spawn } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { platform } from 'node:os';
import type { ToolDefinition } from '../types.js';
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

    console.log('[bash-tool] execute called:', {
      command: input.command,
      working_directory: input.working_directory,
      workspaceRootPath: ctx.workspaceRootPath,
      shellConfigDefaultShell: shellConfig?.defaultShell,
      shellConfigTimeout: shellConfig?.timeout,
    });

    // Resolve shell
    const shell =
      Shell.resolve(shellConfig?.defaultShell ?? '') ?? Shell.preferred();

    console.log('[bash-tool] resolved shell:', {
      shellPath: shell.path,
      shellName: shell.name,
      shellExists: existsSync(shell.path),
    });

    // Resolve working directory
    const cwd = input.working_directory
      ? isAbsolute(input.working_directory)
        ? input.working_directory
        : join(ctx.workspaceRootPath, input.working_directory)
      : ctx.workspaceRootPath;

    console.log('[bash-tool] resolved cwd:', {
      cwd,
      cwdExists: existsSync(cwd),
      cwdIsDir: existsSync(cwd) ? statSync(cwd).isDirectory() : false,
    });

    // Validate CWD exists and is a directory
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      console.error('[bash-tool] CWD validation FAILED:', { cwd });
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

    console.log('[bash-tool] spawn params:', {
      shellPath: shell.path,
      shellArgs,
      cwd,
      timeout,
      isUnix,
      aborted: ctx.abort.aborted,
    });

    // Build environment
    const env = {
      ...process.env,
      ...(ctx.getShellEnv?.(cwd) ?? {}),
      ...input.env,
    };

    // Pre-abort check: avoid spawning a process just to immediately kill it
    if (ctx.abort.aborted) {
      console.log('[bash-tool] pre-abort: signal already aborted');
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
    console.log('[bash-tool] spawned process:', { pid, shellPath: shell.path });

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

        console.log('[bash-tool] close event:', {
          code,
          signal,
          timedOut,
          aborted,
          stdoutLen: stdout.length,
          stderrLen: stderr.length,
          stdoutPreview: stdout.slice(0, 200),
          stderrPreview: stderr.slice(0, 200),
        });

        // Classify the exit
        const errorKind = classifyExitError({
          exitCode: code,
          signal: signal as string | null,
          timedOut,
          aborted,
        });

        const exitReason = toExitReason(errorKind);
        const exitCode = code ?? semanticExitCode(errorKind);

        console.log('[bash-tool] classified exit:', { errorKind, exitReason, exitCode });

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

        const finalResult = {
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
        };
        console.log('[bash-tool] final result:', {
          exitCode: finalResult.result.exitCode,
          exitReason: finalResult.result.exitReason,
          stdoutLen: finalResult.result.stdout.length,
          stderrLen: finalResult.result.stderr.length,
          outputLen: finalResult.result.output.length,
        });
        resolve(finalResult);
      });

      child.on('error', (err) => {
        exited = true;
        clearTimeout(timer);
        ctx.abort.removeEventListener('abort', abortHandler);

        // Log spawn failure for debugging
        console.error('[bash-tool] spawn failed:', {
          command: input.command,
          shell: shell.path,
          cwd,
          error: err.message,
          code: (err as NodeJS.ErrnoException).code,
        });

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
