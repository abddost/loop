/**
 * PolicyEngine -- evaluates permission requests against workspace config
 * and session grants. Wraps tools with needsApproval.
 */

import type { PermissionPolicy, PermissionDecision, PermissionDomain } from '@coding-assistant/shared';
import type { DomainHandler, PermissionContext } from './types.js';
import { PermissionGrantStore } from './store.js';
import { fileEditDomain } from './domains/file-edit.js';
import { shellDomain } from './domains/shell.js';
import { externalDirDomain } from './domains/external-dir.js';
import { networkDomain } from './domains/network.js';
import { toolLoopDomain } from './domains/tool-loop.js';

/** Map tool names to their primary permission domains */
const TOOL_DOMAIN_MAP: Record<string, PermissionDomain> = {
  'file-write': 'file-edit',
  'file-edit': 'file-edit',
  'file-patch': 'file-edit',
  'bash': 'shell',
  'web-search': 'network',
  'web-fetch': 'network',
};

export class PolicyEngine {
  private domains: Map<PermissionDomain, DomainHandler> = new Map();

  constructor() {
    // Register all domain handlers
    this.registerDomain(fileEditDomain);
    this.registerDomain(shellDomain);
    this.registerDomain(externalDirDomain);
    this.registerDomain(networkDomain);
    this.registerDomain(toolLoopDomain);
  }

  registerDomain(handler: DomainHandler): void {
    this.domains.set(handler.domain, handler);
  }

  /**
   * Evaluate a permission request.
   */
  evaluate(
    policy: PermissionPolicy,
    toolName: string,
    input: unknown,
    ctx: { workspaceRootPath: string; sessionId: string },
  ): PermissionDecision {
    const permCtx: PermissionContext = {
      ...ctx,
      policy,
    };

    // Get the primary domain for this tool
    const domain = TOOL_DOMAIN_MAP[toolName];
    if (!domain) {
      // No specific domain -- use default policy
      return { mode: policy.default };
    }

    const handler = this.domains.get(domain);
    if (!handler) {
      return { mode: policy.default };
    }

    // Run domain evaluation
    const decision = handler.evaluate(toolName, input, permCtx);

    // Also check tool-loop detection
    const loopHandler = this.domains.get('tool-loop');
    if (loopHandler) {
      const loopDecision = loopHandler.evaluate(toolName, input, permCtx);
      if (loopDecision.mode === 'ask' || loopDecision.mode === 'deny') {
        return loopDecision;
      }
    }

    return decision;
  }

  /**
   * Wrap an AI SDK ToolSet with needsApproval checks.
   */
  wrapTools(
    tools: Record<string, {
      execute: (input: unknown) => Promise<unknown>;
      [key: string]: unknown;
    }>,
    ctx: {
      policy: PermissionPolicy;
      workspaceRootPath: string;
      sessionId: string;
      grantStore: PermissionGrantStore;
    },
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(tools).map(([name, tool]) => [name, {
        ...tool,
        needsApproval: async ({ input }: { input: unknown }) => {
          const decision = this.evaluate(ctx.policy, name, input, ctx);

          if (decision.mode === 'allow') return false;
          if (decision.mode === 'deny') return decision.reason ?? 'denied';

          // 'ask' mode: check session grants first
          const domain = TOOL_DOMAIN_MAP[name];
          if (domain) {
            const handler = this.domains.get(domain);
            const scope = handler?.extractScope(name, input) ?? '*';
            const grant = ctx.grantStore.findMatch(domain, scope);
            if (grant) return false;
          }

          // No grant found -- needs user approval
          return true;
        },
      }]),
    );
  }
}

export const policyEngine = new PolicyEngine();
