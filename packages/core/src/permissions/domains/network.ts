/**
 * Network access permission domain handler.
 */

import type { PermissionDecision } from '@coding-assistant/shared';
import type { DomainHandler, PermissionContext } from '../types.js';

const NETWORK_TOOLS = ['web-search', 'web-fetch'];

export const networkDomain: DomainHandler = {
  domain: 'network',

  evaluate(toolName, input, ctx): PermissionDecision {
    if (!NETWORK_TOOLS.includes(toolName)) {
      return { mode: 'allow' };
    }

    const domainPolicy = ctx.policy.domains?.['network'];
    if (!domainPolicy) {
      return { mode: ctx.policy.default };
    }

    const url = (input as Record<string, unknown>)?.url as string ?? '';

    // Check deny patterns (blocked domains)
    if (domainPolicy.denyPatterns) {
      for (const pattern of domainPolicy.denyPatterns) {
        if (url.includes(pattern)) {
          return { mode: 'deny', reason: `URL matches deny pattern: ${pattern}` };
        }
      }
    }

    // Check allow patterns
    if (domainPolicy.allowPatterns) {
      for (const pattern of domainPolicy.allowPatterns) {
        if (url.includes(pattern)) {
          return { mode: 'allow' };
        }
      }
    }

    return { mode: domainPolicy.mode };
  },

  extractScope(toolName, input): string {
    if (toolName === 'web-fetch') {
      return (input as Record<string, unknown>)?.url as string ?? '*';
    }
    return '*';
  },
};
