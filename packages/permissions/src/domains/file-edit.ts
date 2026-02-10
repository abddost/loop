/**
 * File edit permission domain handler.
 */

import type { PermissionDecision } from '@coding-assistant/shared';
import type { DomainHandler, PermissionContext } from '../types.js';
import { matchAnyGlob } from '../matchers/glob-matcher.js';

export const fileEditDomain: DomainHandler = {
  domain: 'file-edit',

  evaluate(toolName, input, ctx): PermissionDecision {
    const filePath = (input as Record<string, unknown>)?.path as string ?? '';
    const domainPolicy = ctx.policy.domains?.['file-edit'];

    if (!domainPolicy) {
      return { mode: ctx.policy.default };
    }

    // Check deny patterns first
    if (domainPolicy.denyPatterns && matchAnyGlob(filePath, domainPolicy.denyPatterns)) {
      return { mode: 'deny', reason: `File matches deny pattern` };
    }

    // Check allow patterns
    if (domainPolicy.allowPatterns && matchAnyGlob(filePath, domainPolicy.allowPatterns)) {
      return { mode: 'allow' };
    }

    return { mode: domainPolicy.mode };
  },

  extractScope(_toolName, input): string {
    return (input as Record<string, unknown>)?.path as string ?? '*';
  },
};
