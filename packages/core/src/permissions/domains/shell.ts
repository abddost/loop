/**
 * Shell command permission domain handler.
 *
 * Uses AST-based parsing to evaluate ALL commands in a multi-command string
 * (pipes, chains, subshells) against deny lists, dangerous command sets,
 * path boundary checks, and allow patterns.
 */

import type { PermissionDecision } from '@coding-assistant/shared';
import type { DomainHandler, PermissionContext } from '../types.js';
import { isDeniedCommand } from '../matchers/command-parser.js';
import {
  extractCommands,
  extractReferencedPaths,
} from '../matchers/bash-ast.js';
import { checkPathBoundaries } from '../matchers/boundary-checker.js';
import { normalizeToPattern, matchesPattern } from '../matchers/command-arity.js';

/** Commands that are inherently dangerous and always require user confirmation. */
const DANGEROUS_COMMANDS = new Set([
  'rm', 'rmdir', 'mkfs', 'dd', 'sudo', 'su', 'shutdown', 'reboot',
  'halt', 'poweroff', 'init', 'kill', 'killall', 'pkill',
  'chmod', 'chown', 'chgrp', 'format',
]);

export const shellDomain: DomainHandler = {
  domain: 'shell',

  evaluate(toolName, input, ctx): PermissionDecision {
    const command = (input as Record<string, unknown>)?.command as string ?? '';
    const domainPolicy = ctx.policy.domains?.['shell'];

    // --- Step 1: Extract all commands via AST parser ---
    const allCommands = extractCommands(command);

    // --- Step 2: Check each command against global deniedCommands ---
    const deniedCommands = ctx.policy.deniedCommands ?? [];
    for (const cmd of allCommands) {
      if (isDeniedCommand(cmd.raw, deniedCommands)) {
        return { mode: 'deny', reason: `Command '${cmd.name}' is in the denied list` };
      }
    }

    if (!domainPolicy) {
      return { mode: ctx.policy.default };
    }

    // --- Step 3: Check each command against domain denyPatterns ---
    if (domainPolicy.denyPatterns) {
      for (const cmd of allCommands) {
        if (isDeniedCommand(cmd.raw, domainPolicy.denyPatterns)) {
          return { mode: 'deny', reason: `Command '${cmd.name}' matches deny pattern` };
        }
      }
    }

    // --- Step 4: Check if any command is in DANGEROUS_COMMANDS ---
    for (const cmd of allCommands) {
      if (DANGEROUS_COMMANDS.has(cmd.name)) {
        return { mode: 'ask', reason: `Command '${cmd.name}' is potentially dangerous` };
      }
    }

    // --- Step 5: Check path boundaries for referenced paths ---
    const referencedPaths = extractReferencedPaths(command);
    if (referencedPaths.length > 0) {
      const cwd = (input as Record<string, unknown>)?.cwd as string ?? ctx.workspaceRootPath;
      const result = checkPathBoundaries(referencedPaths, ctx.workspaceRootPath, cwd);
      if (!result.safe) {
        return { mode: 'ask', reason: 'Command accesses paths outside workspace' };
      }
    }

    // --- Step 6: Check allow patterns (arity-aware matching) ---
    // Allow patterns act as prefix matchers: 'git log' allows 'git log --oneline'.
    // Append wildcard to patterns that don't already end with '*'.
    if (domainPolicy.allowPatterns) {
      const expandedPatterns = domainPolicy.allowPatterns.map((p) =>
        p.endsWith('*') ? p : p + ' *',
      );
      const allAllowed = allCommands.length > 0 && allCommands.every((cmd) => {
        return expandedPatterns.some((pattern) => {
          return matchesPattern(cmd.raw, pattern);
        });
      });
      if (allAllowed) return { mode: 'allow' };
    }

    // --- Step 7: Fall through to domain default mode ---
    return { mode: domainPolicy.mode };
  },

  extractScope(_toolName, input): string {
    const command = (input as Record<string, unknown>)?.command as string ?? '';
    if (!command.trim()) return '*';

    // Use the first command's arity-normalized pattern as the grant scope
    const commands = extractCommands(command);
    if (commands.length === 0) return '*';
    return normalizeToPattern(commands[0].raw);
  },
};
