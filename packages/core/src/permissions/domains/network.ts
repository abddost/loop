/**
 * Network access permission domain handler.
 */

import type { PermissionDecision } from '@coding-assistant/shared';
import type { DomainHandler, PermissionContext } from '../types.js';

const NETWORK_TOOLS = ['web-search', 'web-fetch'];

/**
 * Properly match a URL against a domain pattern.
 * Prevents substring-based false positives (e.g. "google.com" matching "not-google.com").
 */
function matchesUrlPattern(url: string, pattern: string): boolean {
  try {
    const parsed = new URL(url);
    // Wildcard subdomain matching: *.example.com
    if (pattern.startsWith('*.')) {
      return parsed.hostname.endsWith(pattern.slice(1));
    }
    // Exact hostname match or subdomain match
    return parsed.hostname === pattern || parsed.hostname.endsWith('.' + pattern);
  } catch {
    // Fallback for non-URL patterns (e.g. search queries)
    return url.includes(pattern);
  }
}

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
        if (matchesUrlPattern(url, pattern)) {
          return { mode: 'deny', reason: `URL matches deny pattern: ${pattern}` };
        }
      }
    }

    // Check allow patterns
    if (domainPolicy.allowPatterns) {
      for (const pattern of domainPolicy.allowPatterns) {
        if (matchesUrlPattern(url, pattern)) {
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
