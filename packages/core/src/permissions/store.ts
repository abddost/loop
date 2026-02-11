/**
 * Permission store -- per-session approved scopes.
 * Re-exports from core for convenience.
 */

import type { PermissionGrant, PermissionDomain } from '@coding-assistant/shared';
import { generatePermissionId } from '@coding-assistant/shared';

export class PermissionGrantStore {
  private grants: PermissionGrant[] = [];

  add(params: {
    sessionId: string;
    domain: PermissionDomain;
    scopePattern: string;
    mode: 'once' | 'always';
  }): PermissionGrant {
    const grant: PermissionGrant = {
      id: generatePermissionId(),
      ...params,
      createdAt: new Date().toISOString(),
    };
    this.grants.push(grant);
    return grant;
  }

  findMatch(domain: PermissionDomain, scope: string): PermissionGrant | null {
    for (let i = 0; i < this.grants.length; i++) {
      const grant = this.grants[i];
      if (grant.domain !== domain) continue;

      if (grant.scopePattern === '*' || this.matchesPattern(scope, grant.scopePattern)) {
        // Consume 'once' grants
        if (grant.mode === 'once') {
          this.grants.splice(i, 1);
        }
        return grant;
      }
    }
    return null;
  }

  private matchesPattern(scope: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern === scope) return true;
    // Simple prefix matching for paths
    if (pattern.endsWith('/**') && scope.startsWith(pattern.slice(0, -3))) return true;
    return false;
  }

  list(): readonly PermissionGrant[] {
    return this.grants;
  }

  clear(): void {
    this.grants = [];
  }
}
