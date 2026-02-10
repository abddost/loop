/**
 * bash tool -- executes shell commands in the workspace.
 */

import { z } from 'zod';
import { spawn } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  command: z.string().describe('The shell command to execute'),
  working_directory: z.string().optional().describe('Working directory (relative to workspace root)'),
  timeout: z.number().optional().default(30000).describe('Timeout in milliseconds'),
});

type Input = z.infer<typeof inputSchema>;

interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export const definition: ToolDefinition<Input, BashResult> = {
  name: 'bash',
  description: 'Execute a shell command in the workspace',
  inputSchema,
  category: 'shell',
  riskLevel: 'dangerous',

  async execute(input, ctx) {
    const cwd = input.working_directory
      ? isAbsolute(input.working_directory)
        ? input.working_directory
        : join(ctx.workspaceRootPath, input.working_directory)
      : ctx.workspaceRootPath;

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const child = spawn('bash', ['-c', input.command], {
        cwd,
        stdio: 'pipe',
        env: { ...process.env },
      });

      // Track the process for cleanup
      ctx.processSpawn('bash', ['-c', input.command], { cwd });

      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
      }, input.timeout);

      // Handle abort signal
      const abortHandler = () => {
        killed = true;
        child.kill('SIGTERM');
        clearTimeout(timer);
      };
      ctx.abort.addEventListener('abort', abortHandler, { once: true });

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
        // Cap output at 100KB
        if (stdout.length > 100_000) {
          stdout = stdout.slice(0, 100_000) + '\n... (output truncated)';
          child.kill('SIGTERM');
        }
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
        if (stderr.length > 100_000) {
          stderr = stderr.slice(0, 100_000) + '\n... (output truncated)';
        }
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        ctx.abort.removeEventListener('abort', abortHandler);

        if (killed && code !== 0) {
          resolve({
            result: {
              stdout,
              stderr: stderr + '\n(process killed)',
              exitCode: code ?? 137,
            },
          });
        } else {
          resolve({
            result: { stdout, stderr, exitCode: code ?? 0 },
          });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        ctx.abort.removeEventListener('abort', abortHandler);
        resolve({
          result: {
            stdout: '',
            stderr: err.message,
            exitCode: 1,
          },
        });
      });
    });
  },
};
