/**
 * PolicyEngine unit tests.
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { PolicyEngine } from '../engine';
import { PermissionGrantStore } from '../store';
import type { PermissionPolicy } from '@coding-assistant/shared';
import type { RawStreamEvent } from '../../execution/stream-mapper';
import type { WrapToolsContext } from '../engine';

// ── Helpers ──────────────────────────────────────────────────────────

function makePolicy(overrides: Partial<PermissionPolicy> = {}): PermissionPolicy {
  return {
    default: 'ask',
    domains: {},
    ...overrides,
  };
}

function makeCtx(): { workspaceRootPath: string; sessionId: string } {
  return {
    workspaceRootPath: '/workspace',
    sessionId: 'session-1',
  };
}

function makeTool(name: string) {
  return {
    execute: async (_input: unknown) => `result from ${name}`,
    description: `Test tool: ${name}`,
  };
}

function makeWrapCtx(
  policy: PermissionPolicy,
  opts: Partial<WrapToolsContext> = {},
): WrapToolsContext {
  return {
    policy,
    workspaceRootPath: '/workspace',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    grantStore: new PermissionGrantStore(),
    emitEvent: (_event: RawStreamEvent) => ({} as any),
    registerRequest: async () => ({ granted: false }),
    abortSignal: new AbortController().signal,
    ...opts,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('PolicyEngine', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine();
  });

  describe('evaluate()', () => {
    test('returns default policy for unmapped tools', () => {
      const decision = engine.evaluate(makePolicy({ default: 'allow' }), 'unknown-tool', {}, makeCtx());
      expect(decision.mode).toBe('allow');
    });

    test('evaluates file-edit domain for file-write tool', () => {
      const policy = makePolicy({
        domains: { 'file-edit': { mode: 'deny' } },
      });
      const decision = engine.evaluate(policy, 'file-write', { path: '/test.txt' }, makeCtx());
      expect(decision.mode).toBe('deny');
    });

    test('evaluates shell domain for bash tool', () => {
      const policy = makePolicy({
        domains: { shell: { mode: 'ask' } },
      });
      const decision = engine.evaluate(policy, 'bash', { command: 'ls' }, makeCtx());
      expect(decision.mode).toBe('ask');
    });

    test('evaluates network domain for web-fetch tool', () => {
      const policy = makePolicy({
        domains: { network: { mode: 'deny', denyPatterns: ['evil.com'] } },
      });
      const decision = engine.evaluate(policy, 'web-fetch', { url: 'https://evil.com/hack' }, makeCtx());
      expect(decision.mode).toBe('deny');
    });

    test('external-dir blocks access outside workspace', () => {
      const policy = makePolicy({
        domains: { 'file-edit': { mode: 'allow' } },
      });
      const ctx = { workspaceRootPath: '/workspace', sessionId: 'session-1' };
      const decision = engine.evaluate(policy, 'file-write', { path: '/etc/passwd' }, ctx);
      expect(decision.mode).toBe('deny');
    });

    test('allows file access within workspace', () => {
      const policy = makePolicy({
        domains: { 'file-edit': { mode: 'allow' } },
      });
      const ctx = { workspaceRootPath: '/workspace', sessionId: 'session-1' };
      const decision = engine.evaluate(policy, 'file-write', { path: '/workspace/src/test.ts' }, ctx);
      expect(decision.mode).toBe('allow');
    });

    test('file-read, glob, grep are mapped to file-edit domain', () => {
      const policy = makePolicy({
        domains: { 'file-edit': { mode: 'ask' } },
      });
      const ctx = makeCtx();
      expect(engine.evaluate(policy, 'file-read', { path: '/workspace/test.ts' }, ctx).mode).toBe('ask');
      expect(engine.evaluate(policy, 'glob', { pattern: '*.ts' }, ctx).mode).toBe('ask');
      expect(engine.evaluate(policy, 'grep', { pattern: 'foo' }, ctx).mode).toBe('ask');
    });

    test('denied commands are blocked', () => {
      const policy = makePolicy({
        deniedCommands: ['rm -rf'],
        domains: { shell: { mode: 'allow' } },
      });
      const decision = engine.evaluate(policy, 'bash', { command: 'rm -rf /' }, makeCtx());
      expect(decision.mode).toBe('deny');
    });
  });

  describe('wrapTools()', () => {
    test('wraps tools with needsApproval', () => {
      const tools = { 'file-write': makeTool('file-write') };
      const ctx = makeWrapCtx(makePolicy());
      const wrapped = engine.wrapTools(tools, ctx);
      expect(wrapped['file-write']).toBeDefined();
      expect((wrapped['file-write'] as any).needsApproval).toBeDefined();
    });

    test('needsApproval returns false for allowed tools', async () => {
      const tools = { 'file-write': makeTool('file-write') };
      const policy = makePolicy({
        domains: { 'file-edit': { mode: 'allow' } },
      });
      const ctx = makeWrapCtx(policy);
      const wrapped = engine.wrapTools(tools, ctx);
      const result = await (wrapped['file-write'] as any).needsApproval(
        { path: '/workspace/test.ts' },
      );
      expect(result).toBe(false);
    });

    test('needsApproval returns deny reason for denied tools', async () => {
      const tools = { 'file-write': makeTool('file-write') };
      const policy = makePolicy({
        domains: { 'file-edit': { mode: 'deny' } },
      });
      const ctx = makeWrapCtx(policy);
      const wrapped = engine.wrapTools(tools, ctx);
      const result = await (wrapped['file-write'] as any).needsApproval(
        { path: '/workspace/test.ts' },
      );
      expect(typeof result).toBe('string');
      expect(result).toContain('denied');
    });

    test('needsApproval checks grants before requesting', async () => {
      const tools = { 'file-write': makeTool('file-write') };
      const policy = makePolicy({
        domains: { 'file-edit': { mode: 'ask' } },
      });
      const grantStore = new PermissionGrantStore();
      grantStore.add({
        sessionId: 'session-1',
        domain: 'file-edit',
        scopePattern: '*',
        mode: 'always',
      });
      const ctx = makeWrapCtx(policy, { grantStore });
      const wrapped = engine.wrapTools(tools, ctx);
      const result = await (wrapped['file-write'] as any).needsApproval(
        { path: '/workspace/test.ts' },
      );
      expect(result).toBe(false);
    });

    test('needsApproval emits event and blocks for ask mode', async () => {
      const tools = { 'bash': makeTool('bash') };
      const policy = makePolicy({
        domains: { shell: { mode: 'ask' } },
      });

      const emittedEvents: any[] = [];
      const emitEvent = (event: any) => {
        emittedEvents.push(event);
        return event;
      };

      const registerRequest = async () => ({ granted: true }); // User approves

      const ctx = makeWrapCtx(policy, { emitEvent, registerRequest });
      const wrapped = engine.wrapTools(tools, ctx);
      const result = await (wrapped['bash'] as any).needsApproval(
        { command: 'ls -la' },
      );

      expect(result).toBe(false); // Approved
      expect(emittedEvents.length).toBe(1);
      expect(emittedEvents[0].type).toBe('permission-request');
      expect(emittedEvents[0].toolName).toBe('bash');
    });

    test('needsApproval returns denial when user denies', async () => {
      const tools = { 'bash': makeTool('bash') };
      const policy = makePolicy({
        domains: { shell: { mode: 'ask' } },
      });

      const registerRequest = async () => ({ granted: false }); // User denies

      const ctx = makeWrapCtx(policy, { registerRequest });
      const wrapped = engine.wrapTools(tools, ctx);
      const result = await (wrapped['bash'] as any).needsApproval(
        { command: 'rm -rf /' },
      );

      expect(typeof result).toBe('string');
      expect(result).toContain('denied');
    });
  });

  describe('filterDeniedTools()', () => {
    test('returns denied tool names', () => {
      const policy = makePolicy({
        domains: {
          'file-edit': { mode: 'deny' },
          shell: { mode: 'allow' },
        },
      });
      const denied = engine.filterDeniedTools(
        ['file-write', 'file-edit', 'bash', 'file-read'],
        policy,
      );
      expect(denied.has('file-write')).toBe(true);
      expect(denied.has('file-edit')).toBe(true);
      expect(denied.has('file-read')).toBe(true);
      expect(denied.has('bash')).toBe(false);
    });

    test('does not deny tools with allowPatterns', () => {
      const policy = makePolicy({
        domains: {
          'file-edit': { mode: 'deny', allowPatterns: ['*.md'] },
        },
      });
      const denied = engine.filterDeniedTools(['file-write'], policy);
      expect(denied.has('file-write')).toBe(false);
    });

    test('skips unmapped tools', () => {
      const policy = makePolicy({ domains: {} });
      const denied = engine.filterDeniedTools(['unknown-tool'], policy);
      expect(denied.size).toBe(0);
    });
  });
});
