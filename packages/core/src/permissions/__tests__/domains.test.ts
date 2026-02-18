/**
 * Domain handler unit tests.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { fileEditDomain } from '../domains/file-edit';
import { shellDomain } from '../domains/shell';
import { externalDirDomain } from '../domains/external-dir';
import { networkDomain } from '../domains/network';
import { toolLoopDomain, clearToolLoopHistory } from '../domains/tool-loop';
import type { PermissionContext } from '../types';
import type { PermissionPolicy } from '@coding-assistant/shared';

function makeCtx(overrides: Partial<PermissionContext> = {}): PermissionContext {
  return {
    workspaceRootPath: '/workspace',
    sessionId: 'test-session',
    policy: {
      default: 'ask',
      domains: {},
    },
    ...overrides,
  };
}

// ── File Edit Domain ────────────────────────────────────────────────

describe('fileEditDomain', () => {
  test('returns default policy when no domain policy exists', () => {
    const decision = fileEditDomain.evaluate('file-write', { path: 'test.txt' }, makeCtx());
    expect(decision.mode).toBe('ask');
  });

  test('denies files matching deny patterns', () => {
    const ctx = makeCtx({
      policy: {
        default: 'allow',
        domains: {
          'file-edit': { mode: 'allow', denyPatterns: ['*.env', '*.secret'] },
        },
      },
    });
    const decision = fileEditDomain.evaluate('file-write', { path: '.env' }, ctx);
    expect(decision.mode).toBe('deny');
  });

  test('allows files matching allow patterns', () => {
    const ctx = makeCtx({
      policy: {
        default: 'deny',
        domains: {
          'file-edit': { mode: 'deny', allowPatterns: ['src/**/*.ts'] },
        },
      },
    });
    const decision = fileEditDomain.evaluate('file-write', { path: 'src/utils/test.ts' }, ctx);
    expect(decision.mode).toBe('allow');
  });

  test('extractScope returns the file path', () => {
    expect(fileEditDomain.extractScope('file-write', { path: '/foo/bar.ts' })).toBe('/foo/bar.ts');
  });
});

// ── Shell Domain ────────────────────────────────────────────────────

describe('shellDomain', () => {
  test('denies commands in the denied list', () => {
    const ctx = makeCtx({
      policy: {
        default: 'allow',
        domains: {},
        deniedCommands: ['rm -rf'],
      },
    });
    const decision = shellDomain.evaluate('bash', { command: 'rm -rf /' }, ctx);
    expect(decision.mode).toBe('deny');
  });

  test('denies commands matching deny patterns', () => {
    const ctx = makeCtx({
      policy: {
        default: 'allow',
        domains: {
          shell: { mode: 'allow', denyPatterns: ['sudo'] },
        },
      },
    });
    const decision = shellDomain.evaluate('bash', { command: 'sudo rm -rf /' }, ctx);
    expect(decision.mode).toBe('deny');
  });

  test('allows commands matching allow patterns with proper parsing', () => {
    const ctx = makeCtx({
      policy: {
        default: 'ask',
        domains: {
          shell: {
            mode: 'ask',
            allowPatterns: ['git log', 'ls', 'cat'],
          },
        },
      },
    });

    // 'git log --oneline' matches pattern 'git log'
    expect(shellDomain.evaluate('bash', { command: 'git log --oneline' }, ctx).mode).toBe('allow');

    // 'ls -la' matches pattern 'ls'
    expect(shellDomain.evaluate('bash', { command: 'ls -la' }, ctx).mode).toBe('allow');

    // 'cat file.txt' matches pattern 'cat'
    expect(shellDomain.evaluate('bash', { command: 'cat file.txt' }, ctx).mode).toBe('allow');
  });

  test('does NOT match partial command names (cat vs catastrophe)', () => {
    const ctx = makeCtx({
      policy: {
        default: 'ask',
        domains: {
          shell: { mode: 'ask', allowPatterns: ['cat'] },
        },
      },
    });

    // 'catastrophe' should NOT match 'cat' pattern
    expect(shellDomain.evaluate('bash', { command: 'catastrophe' }, ctx).mode).toBe('ask');
  });

  test('multi-word patterns match correctly', () => {
    const ctx = makeCtx({
      policy: {
        default: 'ask',
        domains: {
          shell: { mode: 'ask', allowPatterns: ['git diff'] },
        },
      },
    });

    expect(shellDomain.evaluate('bash', { command: 'git diff HEAD~1' }, ctx).mode).toBe('allow');
    expect(shellDomain.evaluate('bash', { command: 'git status' }, ctx).mode).toBe('ask');
  });

  test('extractScope returns arity-normalized pattern', () => {
    // ls has arity 1, so 'ls -la' normalizes to 'ls *'
    expect(shellDomain.extractScope('bash', { command: 'ls -la' })).toBe('ls *');
    // git has arity 2, so 'git log --oneline' normalizes to 'git log *'
    expect(shellDomain.extractScope('bash', { command: 'git log --oneline' })).toBe('git log *');
    // empty command returns wildcard
    expect(shellDomain.extractScope('bash', { command: '' })).toBe('*');
  });
});

// ── External Dir Domain ─────────────────────────────────────────────

describe('externalDirDomain', () => {
  test('allows access within workspace', () => {
    const ctx = makeCtx({ workspaceRootPath: '/workspace' });
    const decision = externalDirDomain.evaluate('file-read', { path: '/workspace/src/test.ts' }, ctx);
    expect(decision.mode).toBe('allow');
  });

  test('denies access outside workspace by default', () => {
    const ctx = makeCtx({ workspaceRootPath: '/workspace' });
    const decision = externalDirDomain.evaluate('file-read', { path: '/etc/passwd' }, ctx);
    expect(decision.mode).toBe('deny');
  });

  test('uses external-dir policy when configured', () => {
    const ctx = makeCtx({
      workspaceRootPath: '/workspace',
      policy: {
        default: 'ask',
        domains: {
          'external-dir': { mode: 'ask' },
        },
      },
    });
    const decision = externalDirDomain.evaluate('file-read', { path: '/etc/config' }, ctx);
    expect(decision.mode).toBe('ask');
  });
});

// ── Network Domain ──────────────────────────────────────────────────

describe('networkDomain', () => {
  test('returns default for non-network tools', () => {
    const ctx = makeCtx();
    const decision = networkDomain.evaluate('file-read', {}, ctx);
    expect(decision.mode).toBe('allow');
  });

  test('denies URLs matching deny patterns with proper domain matching', () => {
    const ctx = makeCtx({
      policy: {
        default: 'allow',
        domains: {
          network: { mode: 'allow', denyPatterns: ['evil.com'] },
        },
      },
    });

    // Exact match
    expect(networkDomain.evaluate('web-fetch', { url: 'https://evil.com/hack' }, ctx).mode).toBe('deny');

    // Subdomain match
    expect(networkDomain.evaluate('web-fetch', { url: 'https://sub.evil.com/hack' }, ctx).mode).toBe('deny');
  });

  test('does NOT substring-match different domains', () => {
    const ctx = makeCtx({
      policy: {
        default: 'allow',
        domains: {
          network: { mode: 'allow', denyPatterns: ['google.com'] },
        },
      },
    });

    // 'not-google.com' should NOT match 'google.com'
    expect(networkDomain.evaluate('web-fetch', { url: 'https://not-google.com' }, ctx).mode).toBe('allow');
  });

  test('supports wildcard subdomain patterns', () => {
    const ctx = makeCtx({
      policy: {
        default: 'deny',
        domains: {
          network: { mode: 'deny', allowPatterns: ['*.example.com'] },
        },
      },
    });

    expect(networkDomain.evaluate('web-fetch', { url: 'https://api.example.com/data' }, ctx).mode).toBe('allow');
    expect(networkDomain.evaluate('web-fetch', { url: 'https://other.com/data' }, ctx).mode).toBe('deny');
  });

  test('extractScope returns URL for web-fetch', () => {
    expect(networkDomain.extractScope('web-fetch', { url: 'https://example.com' })).toBe('https://example.com');
    expect(networkDomain.extractScope('web-search', { query: 'test' })).toBe('*');
  });
});

// ── Tool Loop Domain ────────────────────────────────────────────────

describe('toolLoopDomain', () => {
  beforeEach(() => {
    clearToolLoopHistory('test-session');
  });

  test('allows first call', () => {
    const ctx = makeCtx();
    const decision = toolLoopDomain.evaluate('file-read', { path: 'test.ts' }, ctx);
    expect(decision.mode).toBe('allow');
  });

  test('allows different tools', () => {
    const ctx = makeCtx();
    toolLoopDomain.evaluate('file-read', { path: 'a.ts' }, ctx);
    toolLoopDomain.evaluate('file-write', { path: 'b.ts' }, ctx);
    const decision = toolLoopDomain.evaluate('bash', { command: 'ls' }, ctx);
    expect(decision.mode).toBe('allow');
  });

  test('detects loop after threshold identical calls', () => {
    const ctx = makeCtx();
    const input = { path: 'same-file.ts' };

    // First 3 calls should be OK
    toolLoopDomain.evaluate('file-read', input, ctx);
    toolLoopDomain.evaluate('file-read', input, ctx);
    toolLoopDomain.evaluate('file-read', input, ctx);

    // 4th identical call triggers loop detection
    const decision = toolLoopDomain.evaluate('file-read', input, ctx);
    expect(decision.mode).toBe('ask');
    expect(decision.reason).toBeDefined();
  });

  test('clearToolLoopHistory prevents leak', () => {
    const ctx = makeCtx();
    toolLoopDomain.evaluate('file-read', { path: 'test.ts' }, ctx);
    clearToolLoopHistory('test-session');

    // After clearing, loop count resets
    const decision = toolLoopDomain.evaluate('file-read', { path: 'test.ts' }, ctx);
    expect(decision.mode).toBe('allow');
  });

  test('respects configurable threshold from policy', () => {
    const ctx = makeCtx({
      policy: {
        default: 'ask',
        domains: {},
        toolLoop: { threshold: 2 },
      },
    });
    clearToolLoopHistory('test-session');

    const input = { path: 'test.ts' };
    toolLoopDomain.evaluate('file-read', input, ctx);
    toolLoopDomain.evaluate('file-read', input, ctx);

    // With threshold=2, the 3rd identical call should trigger
    const decision = toolLoopDomain.evaluate('file-read', input, ctx);
    expect(decision.mode).toBe('ask');
  });
});
