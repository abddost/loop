/**
 * PolicyEngine -- evaluates permission requests against workspace config
 * and session grants. Wraps tools with needsApproval.
 */

import type {
  PermissionPolicy,
  PermissionDecision,
  PermissionDomain,
  StreamEvent,
} from '@coding-assistant/shared';
import { generatePermissionId } from '@coding-assistant/shared';
import type { DomainHandler, PermissionContext } from './types.js';
import type { PermissionGrantStore } from './store.js';
import { fileEditDomain } from './domains/file-edit.js';
import { shellDomain } from './domains/shell.js';
import { externalDirDomain } from './domains/external-dir.js';
import { networkDomain } from './domains/network.js';
import { toolLoopDomain } from './domains/tool-loop.js';
import { buildPermissionDescription, getRiskLevel } from './descriptions.js';
import type { RawStreamEvent } from '../execution/stream-mapper.js';

/** Map tool names to their primary permission domains */
const TOOL_DOMAIN_MAP: Record<string, PermissionDomain> = {
  'file-write': 'file-edit',
  'file-edit': 'file-edit',
  'file-patch': 'file-edit',
  'file-read': 'file-edit',
  'bash': 'shell',
  'web-search': 'network',
  'web-fetch': 'network',
  'glob': 'file-edit',
  'grep': 'file-edit',
};

/** Tools that touch files and should be checked against external-dir */
const FILE_TOUCHING_TOOLS = new Set([
  'file-write', 'file-edit', 'file-patch', 'file-read',
  'glob', 'grep', 'bash',
]);

/** Context required by wrapTools for the full permission lifecycle */
export interface WrapToolsContext {
  policy: PermissionPolicy;
  workspaceRootPath: string;
  sessionId: string;
  workspaceId: string;
  grantStore: PermissionGrantStore;
  emitEvent: (event: RawStreamEvent) => StreamEvent;
  registerRequest: (requestId: string, workspaceId: string, sessionId: string) => Promise<{ granted: boolean; mode?: 'once' | 'always' }>;
  abortSignal: AbortSignal;
}

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

    // Secondary check: external directory access
    if (FILE_TOUCHING_TOOLS.has(toolName)) {
      const extDirHandler = this.domains.get('external-dir');
      if (extDirHandler) {
        const extDecision = extDirHandler.evaluate(toolName, input, permCtx);
        if (extDecision.mode === 'deny' || extDecision.mode === 'ask') {
          return extDecision;
        }
      }
    }

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
   *
   * When needsApproval returns true for a tool, the SDK pauses execution.
   * This method handles the full lifecycle:
   * 1. Evaluate the permission policy
   * 2. Check session grants
   * 3. Emit permission-request event
   * 4. Block until user responds
   * 5. Store grant if approved
   */
  wrapTools(
    tools: Record<string, {
      execute: (input: unknown) => Promise<unknown>;
      [key: string]: unknown;
    }>,
    ctx: WrapToolsContext,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(tools).map(([name, tool]) => [name, {
        ...tool,
        needsApproval: async (rawInput: unknown) => {
          // AI SDK v6 passes parsed tool input directly as first argument.
          // Normalize undefined/null to empty object so domain handlers
          // can safely do `(input as Record<string, unknown>)?.field`
          const input = rawInput ?? {};
          const decision = this.evaluate(ctx.policy, name, input, ctx);

          if (decision.mode === 'allow') return false;
          if (decision.mode === 'deny') return decision.reason ?? 'Permission denied by policy';

          // 'ask' mode: check session grants first
          const domain = TOOL_DOMAIN_MAP[name];
          if (domain) {
            const handler = this.domains.get(domain);
            const scope = handler?.extractScope(name, input) ?? '*';
            const grant = ctx.grantStore.findMatch(domain, scope);
            if (grant) return false;
          }

          // No grant found -- emit event and block until user responds
          const requestId = generatePermissionId();

          ctx.emitEvent({
            type: 'permission-request',
            workspaceId: ctx.workspaceId,
            sessionId: ctx.sessionId,
            timestamp: new Date().toISOString(),
            requestId,
            toolName: name,
            domain: domain ?? 'unknown',
            description: buildPermissionDescription(name, input),
            riskLevel: getRiskLevel(name),
            input,
          } as Omit<StreamEvent, 'globalSeq'>);

          // Block until user responds, timeout, or abort
          const result = await Promise.race([
            ctx.registerRequest(requestId, ctx.workspaceId, ctx.sessionId),
            new Promise<{ granted: boolean; mode?: 'once' | 'always' }>((_, reject) => {
              if (ctx.abortSignal.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
              }
              ctx.abortSignal.addEventListener('abort', () => {
                reject(new DOMException('Aborted', 'AbortError'));
              }, { once: true });
            }),
          ]).catch((err) => {
            if (err instanceof DOMException && err.name === 'AbortError') {
              return { granted: false } as { granted: boolean; mode?: 'once' | 'always' };
            }
            throw err;
          });

          if (result.granted) {
            // Store the grant for this session with the user-selected mode
            if (domain) {
              const handler = this.domains.get(domain);
              ctx.grantStore.add({
                sessionId: ctx.sessionId,
                domain,
                scopePattern: handler?.extractScope(name, input) ?? '*',
                mode: result.mode ?? 'once',
              });
            }
            return false; // Proceed with execution
          }

          return 'User denied permission'; // Block execution with reason
        },
      }]),
    );
  }

  /**
   * Filter out tools that are fully denied by policy.
   * Removes them before sending to the LLM to avoid wasting tokens.
   */
  filterDeniedTools(
    toolNames: string[],
    policy: PermissionPolicy,
  ): Set<string> {
    const denied = new Set<string>();
    for (const name of toolNames) {
      const domain = TOOL_DOMAIN_MAP[name];
      if (!domain) continue;
      const domainPolicy = policy.domains?.[domain];
      if (domainPolicy?.mode === 'deny' && !domainPolicy.allowPatterns?.length) {
        denied.add(name);
      }
    }
    return denied;
  }
}

export const policyEngine = new PolicyEngine();
