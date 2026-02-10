/**
 * Per-session permission store.
 * Tracks approved grants for the current session.
 */

import type { PermissionGrant, PermissionDomain } from '@coding-assistant/shared';
import { generatePermissionId } from '@coding-assistant/shared';

export class PermissionStore {
  private grants: PermissionGrant[] = [];

  /**
   * Add a new permission grant.
   */
  addGrant(params: {
    sessionId: string;
    domain: PermissionDomain;
    scopePattern: string;
    mode: 'once' | 'always';
  }): PermissionGrant {
    const grant: PermissionGrant = {
      id: generatePermissionId(),
      sessionId: params.sessionId,
      domain: params.domain,
      scopePattern: params.scopePattern,
      mode: params.mode,
      createdAt: new Date().toISOString(),
    };
    this.grants.push(grant);
    return grant;
  }

  /**
   * Find a matching grant for a tool invocation.
   * Returns the first matching grant or null.
   */
  findMatch(toolName: string, input: unknown): PermissionGrant | null {
    for (const grant of this.grants) {
      // Simple pattern matching -- domain-level match
      if (this.matchesScope(grant, toolName, input)) {
        // If mode is 'once', consume the grant
        if (grant.mode === 'once') {
          this.grants = this.grants.filter((g) => g.id !== grant.id);
        }
        return grant;
      }
    }
    return null;
  }

  private matchesScope(
    grant: PermissionGrant,
    _toolName: string,
    _input: unknown,
  ): boolean {
    // Universal grant
    if (grant.scopePattern === '*') return true;

    // For now, simple string prefix matching
    // Full glob matching is in the permissions package
    return false;
  }

  /**
   * List all active grants.
   */
  list(): readonly PermissionGrant[] {
    return this.grants;
  }

  /**
   * Clear all grants.
   */
  clear(): void {
    this.grants = [];
  }
}
