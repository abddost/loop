/**
 * PermissionGrantStore unit tests.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { PermissionGrantStore } from '../store';

describe('PermissionGrantStore', () => {
  let store: PermissionGrantStore;

  beforeEach(() => {
    store = new PermissionGrantStore();
  });

  describe('add()', () => {
    test('adds a grant and returns it with ID and timestamp', () => {
      const grant = store.add({
        sessionId: 'session-1',
        domain: 'file-edit',
        scopePattern: '*.ts',
        mode: 'once',
      });

      expect(grant.id).toBeDefined();
      expect(grant.sessionId).toBe('session-1');
      expect(grant.domain).toBe('file-edit');
      expect(grant.scopePattern).toBe('*.ts');
      expect(grant.mode).toBe('once');
      expect(grant.createdAt).toBeDefined();
    });
  });

  describe('findMatch()', () => {
    test('matches by domain and wildcard scope', () => {
      store.add({
        sessionId: 'session-1',
        domain: 'file-edit',
        scopePattern: '*',
        mode: 'always',
      });

      const match = store.findMatch('file-edit', '/any/path.ts');
      expect(match).toBeDefined();
      expect(match!.domain).toBe('file-edit');
    });

    test('matches by exact scope', () => {
      store.add({
        sessionId: 'session-1',
        domain: 'file-edit',
        scopePattern: '/workspace/src/test.ts',
        mode: 'once',
      });

      const match = store.findMatch('file-edit', '/workspace/src/test.ts');
      expect(match).toBeDefined();
    });

    test('does not match wrong domain', () => {
      store.add({
        sessionId: 'session-1',
        domain: 'shell',
        scopePattern: '*',
        mode: 'always',
      });

      const match = store.findMatch('file-edit', '/test.ts');
      expect(match).toBeNull();
    });

    test('does not match wrong scope', () => {
      store.add({
        sessionId: 'session-1',
        domain: 'file-edit',
        scopePattern: '/workspace/src/specific.ts',
        mode: 'always',
      });

      const match = store.findMatch('file-edit', '/workspace/other.ts');
      expect(match).toBeNull();
    });

    test('matches prefix with glob pattern', () => {
      store.add({
        sessionId: 'session-1',
        domain: 'file-edit',
        scopePattern: '/workspace/src/**',
        mode: 'always',
      });

      const match = store.findMatch('file-edit', '/workspace/src/deep/file.ts');
      expect(match).toBeDefined();
    });
  });

  describe('once grants', () => {
    test('once grant is consumed after first match', () => {
      store.add({
        sessionId: 'session-1',
        domain: 'file-edit',
        scopePattern: '*',
        mode: 'once',
      });

      // First match consumes it
      const first = store.findMatch('file-edit', '/test.ts');
      expect(first).toBeDefined();

      // Second match should not find it
      const second = store.findMatch('file-edit', '/test.ts');
      expect(second).toBeNull();
    });
  });

  describe('always grants', () => {
    test('always grant persists after match', () => {
      store.add({
        sessionId: 'session-1',
        domain: 'shell',
        scopePattern: '*',
        mode: 'always',
      });

      // Both matches should succeed
      expect(store.findMatch('shell', 'ls')).toBeDefined();
      expect(store.findMatch('shell', 'cat')).toBeDefined();
      expect(store.findMatch('shell', 'git log')).toBeDefined();
    });
  });

  describe('list()', () => {
    test('returns all grants', () => {
      store.add({ sessionId: 's', domain: 'file-edit', scopePattern: '*', mode: 'once' });
      store.add({ sessionId: 's', domain: 'shell', scopePattern: '*', mode: 'always' });
      expect(store.list().length).toBe(2);
    });
  });

  describe('clear()', () => {
    test('removes all grants', () => {
      store.add({ sessionId: 's', domain: 'file-edit', scopePattern: '*', mode: 'always' });
      store.clear();
      expect(store.list().length).toBe(0);
      expect(store.findMatch('file-edit', '/test')).toBeNull();
    });
  });
});
