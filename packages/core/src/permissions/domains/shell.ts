/**
 * Shell command permission domain handler.
 */

import type { PermissionDecision } from '@coding-assistant/shared';
import type { DomainHandler, PermissionContext } from '../types.js';
import { isDeniedCommand } from '../matchers/command-parser.js';

export const shellDomain: DomainHandler = {
  domain: 'shell',

  evaluate(toolName, input, ctx): PermissionDecision {
    const command = (input as Record<string, unknown>)?.command as string ?? '';
    const domainPolicy = ctx.policy.domains?.['shell'];

    // Check global denied commands first
    const shellConfig = ctx.policy as Record<string, unknown>;
    const deniedCommands = (shellConfig?.deniedCommands as string[]) ?? [];
    if (isDeniedCommand(command, deniedCommands)) {
      return { mode: 'deny', reason: 'Command is in the denied list' };
    }

    if (!domainPolicy) {
      return { mode: ctx.policy.default };
    }

    // Check deny patterns
    if (domainPolicy.denyPatterns && isDeniedCommand(command, domainPolicy.denyPatterns)) {
      return { mode: 'deny', reason: 'Command matches deny pattern' };
    }

    // Check allow patterns
    if (domainPolicy.allowPatterns) {
      const isAllowed = domainPolicy.allowPatterns.some((p) =>
        command.startsWith(p) || command === p,
      );
      if (isAllowed) return { mode: 'allow' };
    }

    return { mode: domainPolicy.mode };
  },

  extractScope(_toolName, input): string {
    return (input as Record<string, unknown>)?.command as string ?? '*';
  },
};
