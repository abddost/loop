/**
 * Permission types for the rule-based permission system.
 */

export type PermissionAction = 'allow' | 'deny' | 'ask';

export interface PermissionRule {
  permission: string;
  pattern: string;
  action: PermissionAction;
}

export type PermissionRuleset = PermissionRule[];

export type PermissionReply = 'once' | 'always' | 'reject';

export interface PermissionRequest {
  id: string;
  workspaceId: string;
  sessionId: string;
  permission: string;
  patterns: string[];
  always: string[];
  toolName: string;
  description: string;
  riskLevel: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface PermissionResponse {
  requestId: string;
  granted: boolean;
  mode: 'once' | 'always';
  feedback?: string;
}

/** Config-level permission format (flat key→action or key→{pattern→action}) */
export type PermissionConfig = Record<string, PermissionAction | Record<string, PermissionAction>>;

// ── Legacy compat re-exports ─────────────────────────────────────────

/** @deprecated Use PermissionAction */
export type PermissionDecisionMode = PermissionAction;

/** @deprecated Use PermissionRuleset */
export type PermissionDomain = string;

/** @deprecated Domain-based policy — use PermissionConfig instead */
export interface PermissionPolicy {
  default: PermissionAction;
  domains: Partial<Record<string, PermissionDomainPolicy>>;
  deniedCommands?: string[];
  toolLoop?: {
    threshold?: number;
    windowMs?: number;
    maxHistory?: number;
  };
}

/** @deprecated */
export interface PermissionDomainPolicy {
  mode: PermissionAction;
  allowPatterns?: string[];
  denyPatterns?: string[];
}

/** @deprecated */
export interface PermissionDecision {
  mode: PermissionAction;
  reason?: string;
}

/** @deprecated */
export interface PermissionGrant {
  id: string;
  sessionId: string;
  domain: string;
  scopePattern: string;
  mode: 'once' | 'always';
  createdAt: string;
}
