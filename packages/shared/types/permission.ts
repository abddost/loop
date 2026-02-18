/**
 * Permission engine types.
 */

export type PermissionDomain =
  | 'file-edit'
  | 'shell'
  | 'external-dir'
  | 'network'
  | 'tool-loop';

export type PermissionDecisionMode = 'allow' | 'ask' | 'deny';

export interface PermissionDecision {
  mode: PermissionDecisionMode;
  reason?: string;
}

export interface PermissionGrant {
  id: string;
  sessionId: string;
  domain: PermissionDomain;
  scopePattern: string;
  mode: 'once' | 'always';
  createdAt: string;
}

export interface PermissionRequest {
  id: string;
  workspaceId: string;
  sessionId: string;
  toolName: string;
  domain: PermissionDomain;
  input: unknown;
  description: string;
  riskLevel: string;
  timestamp: string;
}

export interface PermissionResponse {
  requestId: string;
  granted: boolean;
  mode: 'once' | 'always';
  scopePattern?: string;
}

export interface PermissionPolicy {
  /** Global default for unmatched tools */
  default: PermissionDecisionMode;
  /** Per-domain overrides */
  domains: Partial<Record<PermissionDomain, PermissionDomainPolicy>>;
  /** Commands that are always denied for the shell domain */
  deniedCommands?: string[];
  /** Tool loop detection configuration */
  toolLoop?: {
    threshold?: number;     // default 3
    windowMs?: number;      // default 60000
    maxHistory?: number;    // default 50
  };
}

export interface PermissionDomainPolicy {
  mode: PermissionDecisionMode;
  /** Glob patterns that are always allowed */
  allowPatterns?: string[];
  /** Glob patterns that are always denied */
  denyPatterns?: string[];
}
