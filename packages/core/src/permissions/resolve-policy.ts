/**
 * Merge agent permissionProfile with workspace PermissionPolicy.
 *
 * Agent profile acts as overrides on top of workspace defaults.
 * Special keys like 'bash:git log' are granular shell sub-command overrides
 * that get collected into shell allowPatterns.
 */

import type {
  PermissionPolicy,
  PermissionDomainPolicy,
  PermissionDecisionMode,
  PermissionDomain,
} from '@coding-assistant/shared';

export interface ResolvedPermissionPolicy extends PermissionPolicy {
  /** Granular shell sub-commands extracted from agent profile (e.g. 'bash:git log' -> 'git log') */
  shellSubCommands?: string[];
  /** Commands explicitly denied */
  deniedCommands?: string[];
}

/** Map agent profile keys to domain names */
const PROFILE_KEY_TO_DOMAIN: Record<string, PermissionDomain> = {
  'file-write': 'file-edit',
  'file-edit': 'file-edit',
  'shell': 'shell',
  'external-dir': 'external-dir',
  'network': 'network',
};

/**
 * Merge agent permissionProfile with workspace PermissionPolicy.
 * Agent profile overrides take precedence over workspace defaults.
 */
export function resolvePermissionPolicy(
  workspacePolicy: PermissionPolicy,
  agentProfile: Record<string, PermissionDecisionMode>,
): ResolvedPermissionPolicy {
  // Start with a deep clone of the workspace policy
  const resolved: ResolvedPermissionPolicy = {
    default: workspacePolicy.default,
    domains: { ...workspacePolicy.domains },
  };

  // Ensure domains object exists
  if (!resolved.domains) {
    resolved.domains = {};
  }

  const shellSubCommands: string[] = [];

  for (const [key, mode] of Object.entries(agentProfile)) {
    // Handle granular bash sub-commands: 'bash:git log' -> shell allowPattern
    if (key.startsWith('bash:')) {
      const subCommand = key.slice(5); // Remove 'bash:' prefix
      if (mode === 'allow') {
        shellSubCommands.push(subCommand);
      }
      continue;
    }

    // Map profile key to domain
    const domain = PROFILE_KEY_TO_DOMAIN[key];
    if (!domain) continue;

    // Get or create domain policy
    const existing: PermissionDomainPolicy = resolved.domains[domain]
      ? { ...resolved.domains[domain]! }
      : { mode: workspacePolicy.default };

    // Agent profile overrides the mode
    existing.mode = mode;

    // Clone patterns arrays if they exist
    if (existing.allowPatterns) {
      existing.allowPatterns = [...existing.allowPatterns];
    }
    if (existing.denyPatterns) {
      existing.denyPatterns = [...existing.denyPatterns];
    }

    resolved.domains[domain] = existing;
  }

  // If agent profile specified granular bash commands, merge them into
  // the shell domain's allowPatterns
  if (shellSubCommands.length > 0) {
    resolved.shellSubCommands = shellSubCommands;

    const shellPolicy: PermissionDomainPolicy = resolved.domains.shell
      ? { ...resolved.domains.shell }
      : { mode: workspacePolicy.default };

    shellPolicy.allowPatterns = [
      ...(shellPolicy.allowPatterns ?? []),
      ...shellSubCommands,
    ];
    resolved.domains.shell = shellPolicy;
  }

  // Carry forward deniedCommands from workspace policy if present
  if (workspacePolicy.deniedCommands) {
    resolved.deniedCommands = workspacePolicy.deniedCommands;
  }

  return resolved;
}
