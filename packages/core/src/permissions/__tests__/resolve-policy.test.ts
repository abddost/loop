/**
 * resolvePermissionPolicy unit tests.
 */

import { describe, test, expect } from 'bun:test';
import { resolvePermissionPolicy } from '../resolve-policy';
import type { PermissionPolicy } from '@coding-assistant/shared';

function makePolicy(overrides: Partial<PermissionPolicy> = {}): PermissionPolicy {
  return {
    default: 'ask',
    domains: {},
    ...overrides,
  };
}

describe('resolvePermissionPolicy', () => {
  test('returns workspace policy when agent profile is empty', () => {
    const workspace = makePolicy({ default: 'allow' });
    const resolved = resolvePermissionPolicy(workspace, {});
    expect(resolved.default).toBe('allow');
  });

  test('maps file-write to file-edit domain', () => {
    const workspace = makePolicy();
    const resolved = resolvePermissionPolicy(workspace, {
      'file-write': 'deny',
    });
    expect(resolved.domains['file-edit']?.mode).toBe('deny');
  });

  test('maps shell to shell domain', () => {
    const workspace = makePolicy();
    const resolved = resolvePermissionPolicy(workspace, {
      shell: 'ask',
    });
    expect(resolved.domains.shell?.mode).toBe('ask');
  });

  test('maps external-dir to external-dir domain', () => {
    const workspace = makePolicy();
    const resolved = resolvePermissionPolicy(workspace, {
      'external-dir': 'deny',
    });
    expect(resolved.domains['external-dir']?.mode).toBe('deny');
  });

  test('maps network to network domain', () => {
    const workspace = makePolicy();
    const resolved = resolvePermissionPolicy(workspace, {
      network: 'allow',
    });
    expect(resolved.domains.network?.mode).toBe('allow');
  });

  test('agent profile overrides workspace domain policy', () => {
    const workspace = makePolicy({
      domains: { shell: { mode: 'allow' } },
    });
    const resolved = resolvePermissionPolicy(workspace, {
      shell: 'deny',
    });
    expect(resolved.domains.shell?.mode).toBe('deny');
  });

  test('extracts bash:* sub-commands into shellSubCommands', () => {
    const workspace = makePolicy();
    const resolved = resolvePermissionPolicy(workspace, {
      'bash:git log': 'allow',
      'bash:git diff': 'allow',
      'bash:ls': 'allow',
    });

    expect(resolved.shellSubCommands).toBeDefined();
    expect(resolved.shellSubCommands).toContain('git log');
    expect(resolved.shellSubCommands).toContain('git diff');
    expect(resolved.shellSubCommands).toContain('ls');
  });

  test('bash sub-commands are added to shell allowPatterns', () => {
    const workspace = makePolicy();
    const resolved = resolvePermissionPolicy(workspace, {
      shell: 'ask',
      'bash:git log': 'allow',
      'bash:cat': 'allow',
    });

    const shellPolicy = resolved.domains.shell;
    expect(shellPolicy?.allowPatterns).toContain('git log');
    expect(shellPolicy?.allowPatterns).toContain('cat');
    expect(shellPolicy?.mode).toBe('ask');
  });

  test('preserves workspace allowPatterns when merging', () => {
    const workspace = makePolicy({
      domains: {
        shell: { mode: 'ask', allowPatterns: ['echo'] },
      },
    });
    const resolved = resolvePermissionPolicy(workspace, {
      'bash:ls': 'allow',
    });

    const shellPolicy = resolved.domains.shell;
    expect(shellPolicy?.allowPatterns).toContain('echo');
    expect(shellPolicy?.allowPatterns).toContain('ls');
  });

  test('carries forward deniedCommands from workspace', () => {
    const workspace: PermissionPolicy = {
      default: 'ask',
      domains: {},
      deniedCommands: ['rm -rf', 'sudo'],
    };
    const resolved = resolvePermissionPolicy(workspace, {});
    expect(resolved.deniedCommands).toEqual(['rm -rf', 'sudo']);
  });

  test('full plan agent profile resolves correctly', () => {
    const workspace = makePolicy();
    const planProfile = {
      'file-write': 'deny' as const,
      'shell': 'ask' as const,
      'external-dir': 'deny' as const,
      'network': 'ask' as const,
      'bash:ls': 'allow' as const,
      'bash:cat': 'allow' as const,
      'bash:git log': 'allow' as const,
      'bash:git diff': 'allow' as const,
      'bash:git status': 'allow' as const,
    };

    const resolved = resolvePermissionPolicy(workspace, planProfile);

    expect(resolved.domains['file-edit']?.mode).toBe('deny');
    expect(resolved.domains.shell?.mode).toBe('ask');
    expect(resolved.domains['external-dir']?.mode).toBe('deny');
    expect(resolved.domains.network?.mode).toBe('ask');
    expect(resolved.domains.shell?.allowPatterns).toContain('ls');
    expect(resolved.domains.shell?.allowPatterns).toContain('git log');
  });
});
