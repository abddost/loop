/**
 * Rule-based permission engine.
 *
 * Replaces the domain-based PolicyEngine with a single flat ruleset model.
 * Rules are evaluated with "last match wins" semantics via `findLast()`.
 *
 * Core API:
 *   Permission.fromConfig(config) → Ruleset
 *   Permission.merge(...rulesets)  → Ruleset
 *   Permission.evaluate(permission, pattern, ...rulesets) → Rule
 *   Permission.disabled(tools, ruleset) → Set<string>
 *   Permission.ask(input) → Promise<void>
 */

import { Wildcard } from './wildcard.js';
import { generatePermissionId } from '@coding-assistant/shared';

export namespace Permission {
  export type Action = 'allow' | 'deny' | 'ask';

  export interface Rule {
    permission: string;
    pattern: string;
    action: Action;
  }

  export type Ruleset = Rule[];

  export interface AskInput {
    permission: string;
    patterns: string[];
    always: string[];
    metadata: Record<string, unknown>;
    sessionId: string;
    ruleset: Ruleset;
    emitEvent: (event: Record<string, unknown>) => void;
    registerRequest: (
      requestId: string,
      workspaceId: string,
      sessionId: string,
    ) => Promise<{ granted: boolean; mode?: 'once' | 'always'; feedback?: string }>;
    workspaceId: string;
    abortSignal: AbortSignal;
    toolName?: string;
    description?: string;
    riskLevel?: string;
  }

  // ── Session-scoped approved rules ──────────────────────────────────

  const _approved = new Map<string, Ruleset>();
  const _pending = new Map<string, Map<string, {
    resolve: () => void;
    reject: (err: Error) => void;
    permission: string;
    patterns: string[];
  }>>();

  export function getApproved(sessionId: string): Ruleset {
    return _approved.get(sessionId) ?? [];
  }

  export function clearApproved(sessionId: string): void {
    _approved.delete(sessionId);
    _pending.delete(sessionId);
  }

  // ── Config → Ruleset ───────────────────────────────────────────────

  export function fromConfig(
    config: Record<string, Action | Record<string, Action>>,
  ): Ruleset {
    const rules: Ruleset = [];
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        rules.push({ permission: key, pattern: '*', action: value });
      } else {
        for (const [pattern, action] of Object.entries(value)) {
          rules.push({ permission: key, pattern, action });
        }
      }
    }
    return rules;
  }

  // ── Merge ──────────────────────────────────────────────────────────

  export function merge(...rulesets: Ruleset[]): Ruleset {
    return rulesets.flat();
  }

  // ── Evaluate ───────────────────────────────────────────────────────

  export function evaluate(
    permission: string,
    pattern: string,
    ...rulesets: Ruleset[]
  ): Rule {
    const merged = merge(...rulesets);

    // Last match wins — iterate in reverse
    for (let i = merged.length - 1; i >= 0; i--) {
      const rule = merged[i];
      if (
        Wildcard.match(permission, rule.permission) &&
        Wildcard.match(pattern, rule.pattern)
      ) {
        return rule;
      }
    }

    return { action: 'ask', permission, pattern: '*' };
  }

  // ── Disabled tools ─────────────────────────────────────────────────

  export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
    const result = new Set<string>();
    for (const tool of tools) {
      const rule = evaluate(tool, '*', ruleset);
      if (rule.action === 'deny') {
        result.add(tool);
      }
    }
    return result;
  }

  // ── Ask ────────────────────────────────────────────────────────────

  export async function ask(input: AskInput): Promise<void> {
    const approved = getApproved(input.sessionId);
    const combinedRuleset = merge(input.ruleset, approved);

    for (const pattern of input.patterns) {
      const rule = evaluate(input.permission, pattern, combinedRuleset);

      if (rule.action === 'allow') continue;

      if (rule.action === 'deny') {
        throw new PermissionDeniedError(input.permission, pattern);
      }

      // action === 'ask': emit event, block until response
      const requestId = generatePermissionId();

      input.emitEvent({
        type: 'permission-request',
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        timestamp: new Date().toISOString(),
        requestId,
        toolName: input.toolName ?? input.permission,
        permission: input.permission,
        patterns: input.patterns,
        always: input.always,
        description: input.description ?? `Permission required: ${input.permission}`,
        riskLevel: input.riskLevel ?? 'moderate',
        metadata: input.metadata,
      });

      const result = await Promise.race([
        input.registerRequest(requestId, input.workspaceId, input.sessionId),
        new Promise<never>((_, reject) => {
          if (input.abortSignal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          input.abortSignal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
      ]).catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return { granted: false, feedback: undefined } as {
            granted: boolean;
            mode?: 'once' | 'always';
            feedback?: string;
          };
        }
        throw err;
      });

      if (!result.granted) {
        if (result.feedback) {
          throw new PermissionCorrectedError(result.feedback);
        }
        throw new PermissionRejectedError();
      }

      // Store approved rules if "always"
      if (result.mode === 'always') {
        const sessionApproved = _approved.get(input.sessionId) ?? [];
        for (const alwaysPattern of input.always) {
          sessionApproved.push({
            permission: input.permission,
            pattern: alwaysPattern,
            action: 'allow',
          });
        }
        _approved.set(input.sessionId, sessionApproved);

        // Auto-resolve matching pending requests for this session
        autoResolvePending(input.sessionId);
      }

      // Once approved for one pattern, skip remaining patterns
      return;
    }
  }

  function autoResolvePending(sessionId: string): void {
    const pendingMap = _pending.get(sessionId);
    if (!pendingMap) return;

    const approved = getApproved(sessionId);

    for (const [reqId, entry] of pendingMap) {
      const allAllowed = entry.patterns.every((p) => {
        const rule = evaluate(entry.permission, p, approved);
        return rule.action === 'allow';
      });

      if (allAllowed) {
        entry.resolve();
        pendingMap.delete(reqId);
      }
    }
  }
}

// ── Error classes (exported at module level) ─────────────────────────

export class PermissionDeniedError extends Error {
  public readonly permission: string;
  public readonly pattern: string;

  constructor(permission: string, pattern: string) {
    super(`Permission denied: ${permission} for pattern "${pattern}"`);
    this.name = 'PermissionDeniedError';
    this.permission = permission;
    this.pattern = pattern;
  }
}

export class PermissionRejectedError extends Error {
  constructor() {
    super('The user rejected permission to use this tool call.');
    this.name = 'PermissionRejectedError';
  }
}

export class PermissionCorrectedError extends Error {
  public readonly feedback: string;

  constructor(feedback: string) {
    super(`The user rejected with feedback: ${feedback}`);
    this.name = 'PermissionCorrectedError';
    this.feedback = feedback;
  }
}
