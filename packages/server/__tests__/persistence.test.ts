/**
 * Persistence layer tests -- bun:sqlite repositories and migrations.
 *
 * Each test suite gets a fresh in-memory database so tests are fully isolated.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { up, down } from '../persistence/migrations/001_initial.js';
import { WorkspaceRepository } from '../persistence/repositories/workspace-repo.js';
import { SessionRepository } from '../persistence/repositories/session-repo.js';
import { MessageRepository } from '../persistence/repositories/message-repo.js';
import { ConfigRepository } from '../persistence/repositories/config-repo.js';

import type { SessionInfo, Message, MessagePart } from '@coding-assistant/shared';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a fresh in-memory DB with migrations applied. */
function freshDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  up(db);
  return db;
}

function makeWorkspace(overrides: Partial<{ id: string; name: string; rootPath: string; createdAt: string }> = {}) {
  return {
    id: overrides.id ?? `ws-${crypto.randomUUID().slice(0, 8)}`,
    name: overrides.name ?? 'Test Workspace',
    rootPath: overrides.rootPath ?? `/tmp/test-${Date.now()}`,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

function makeSession(workspaceId: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: overrides.id ?? `sess-${crypto.randomUUID().slice(0, 8)}`,
    workspaceId,
    title: overrides.title ?? 'Test Session',
    status: overrides.status ?? 'idle',
    agentId: overrides.agentId ?? 'build',
    parentSessionId: overrides.parentSessionId ?? null,
    forkMessageIndex: overrides.forkMessageIndex ?? null,
    summaryText: overrides.summaryText ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  };
}

function makeMessage(sessionId: string, index: number, overrides: Partial<Omit<Message, 'parts'>> = {}): Omit<Message, 'parts'> {
  return {
    id: overrides.id ?? `msg-${crypto.randomUUID().slice(0, 8)}`,
    sessionId,
    role: overrides.role ?? 'user',
    index,
    modelId: overrides.modelId ?? null,
    finishReason: overrides.finishReason ?? null,
    usage: overrides.usage ?? null,
    error: overrides.error ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

function makeTextPart(index: number, text: string): MessagePart & { messageId: string } {
  return {
    type: 'text',
    id: `part-${crypto.randomUUID().slice(0, 8)}`,
    index,
    text,
    messageId: '', // caller sets
  };
}

function makeStreamEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'session-status',
    workspaceId: overrides.workspaceId ?? 'ws-1',
    sessionId: overrides.sessionId ?? 'sess-1',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    status: 'idle',
    ...overrides,
  };
}

// ── Migration Tests ──────────────────────────────────────────────────────────

describe('Migrations', () => {
  test('up() creates all required tables', () => {
    const db = new Database(':memory:');
    up(db);

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name).sort();

    expect(tableNames).toContain('workspaces');
    expect(tableNames).toContain('sessions');
    expect(tableNames).toContain('messages');
    expect(tableNames).toContain('message_parts');
    expect(tableNames).toContain('permission_grants');
    expect(tableNames).toContain('migrations');

    db.close();
  });

  test('up() is idempotent -- running twice does not throw', () => {
    const db = new Database(':memory:');
    up(db);
    expect(() => up(db)).not.toThrow();

    // Migrations table should still have exactly one row
    const count = db.prepare('SELECT COUNT(*) as cnt FROM migrations').get() as { cnt: number };
    expect(count.cnt).toBe(1);

    db.close();
  });

  test('up() records migration in migrations table', () => {
    const db = new Database(':memory:');
    up(db);

    const row = db.prepare('SELECT id, name FROM migrations WHERE id = 1').get() as { id: number; name: string } | null;
    expect(row).not.toBeNull();
    expect(row!.name).toBe('001_initial');

    db.close();
  });

  test('down() drops all tables', () => {
    const db = new Database(':memory:');
    up(db);
    down(db);

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      .all() as { name: string }[];

    expect(tables.length).toBe(0);

    db.close();
  });

  test('creates expected indexes', () => {
    const db = new Database(':memory:');
    up(db);

    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name`)
      .all() as { name: string }[];

    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain('idx_sessions_workspace');
    expect(indexNames).toContain('idx_sessions_parent');
    expect(indexNames).toContain('idx_messages_session');
    expect(indexNames).toContain('idx_parts_message');
    expect(indexNames).toContain('idx_events_workspace_session');
    expect(indexNames).toContain('idx_events_seq');
    expect(indexNames).toContain('idx_grants_session');

    db.close();
  });
});

// ── WorkspaceRepository Tests ────────────────────────────────────────────────

describe('WorkspaceRepository', () => {
  let db: Database;
  let repo: WorkspaceRepository;

  beforeEach(() => {
    db = freshDb();
    repo = new WorkspaceRepository(db);
  });

  test('create() and findById()', () => {
    const ws = makeWorkspace({ id: 'ws-1', name: 'My Workspace', rootPath: '/projects/app' });
    repo.create(ws);

    const found = repo.findById('ws-1');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('ws-1');
    expect(found!.name).toBe('My Workspace');
    expect(found!.rootPath).toBe('/projects/app');
  });

  test('findById() returns null for non-existent workspace', () => {
    const found = repo.findById('does-not-exist');
    expect(found).toBeNull();
  });

  test('findByRootPath()', () => {
    const ws = makeWorkspace({ rootPath: '/home/user/project' });
    repo.create(ws);

    const found = repo.findByRootPath('/home/user/project');
    expect(found).not.toBeNull();
    expect(found!.id).toBe(ws.id);
  });

  test('findByRootPath() returns null for unknown path', () => {
    const found = repo.findByRootPath('/no/such/path');
    expect(found).toBeNull();
  });

  test('list() returns all workspaces ordered by createdAt DESC', () => {
    const ws1 = makeWorkspace({ id: 'ws-old', createdAt: '2025-01-01T00:00:00Z', rootPath: '/a' });
    const ws2 = makeWorkspace({ id: 'ws-new', createdAt: '2026-01-01T00:00:00Z', rootPath: '/b' });
    repo.create(ws1);
    repo.create(ws2);

    const all = repo.list();
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe('ws-new'); // most recent first
    expect(all[1].id).toBe('ws-old');
  });

  test('list() returns empty array when no workspaces', () => {
    expect(repo.list()).toEqual([]);
  });

  test('updateConfig()', () => {
    const ws = makeWorkspace();
    repo.create(ws);

    repo.updateConfig(ws.id, JSON.stringify({ theme: 'dark' }));

    // Verify via raw query (config is not returned by findById)
    const row = db.prepare('SELECT configJson FROM workspaces WHERE id = ?').get(ws.id) as { configJson: string };
    expect(JSON.parse(row.configJson)).toEqual({ theme: 'dark' });
  });

  test('delete() removes workspace', () => {
    const ws = makeWorkspace();
    repo.create(ws);
    expect(repo.findById(ws.id)).not.toBeNull();

    repo.delete(ws.id);
    expect(repo.findById(ws.id)).toBeNull();
  });

  test('rootPath UNIQUE constraint prevents duplicates', () => {
    const ws1 = makeWorkspace({ id: 'ws-1', rootPath: '/same/path' });
    const ws2 = makeWorkspace({ id: 'ws-2', rootPath: '/same/path' });
    repo.create(ws1);

    expect(() => repo.create(ws2)).toThrow();
  });
});

// ── SessionRepository Tests ──────────────────────────────────────────────────

describe('SessionRepository', () => {
  let db: Database;
  let workspaceRepo: WorkspaceRepository;
  let repo: SessionRepository;
  let workspaceId: string;

  beforeEach(() => {
    db = freshDb();
    workspaceRepo = new WorkspaceRepository(db);
    repo = new SessionRepository(db);

    const ws = makeWorkspace({ id: 'ws-test' });
    workspaceRepo.create(ws);
    workspaceId = ws.id;
  });

  test('create() and findById()', () => {
    const session = makeSession(workspaceId, { id: 'sess-1', title: 'Chat 1' });
    repo.create(session);

    const found = repo.findById('sess-1');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('sess-1');
    expect(found!.title).toBe('Chat 1');
    expect(found!.workspaceId).toBe(workspaceId);
    expect(found!.status).toBe('idle');
    expect(found!.agentId).toBe('build');
  });

  test('findById() returns null for non-existent session', () => {
    expect(repo.findById('no-such-session')).toBeNull();
  });

  test('listByWorkspace() returns sessions for a workspace', () => {
    const s1 = makeSession(workspaceId, { id: 'sess-1', updatedAt: '2025-01-01T00:00:00Z' });
    const s2 = makeSession(workspaceId, { id: 'sess-2', updatedAt: '2026-01-01T00:00:00Z' });
    repo.create(s1);
    repo.create(s2);

    const sessions = repo.listByWorkspace(workspaceId);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].id).toBe('sess-2'); // most recently updated first
    expect(sessions[1].id).toBe('sess-1');
  });

  test('listByWorkspace() does not return sessions from other workspaces', () => {
    const ws2 = makeWorkspace({ id: 'ws-other', rootPath: '/other' });
    workspaceRepo.create(ws2);

    const s1 = makeSession(workspaceId, { id: 'sess-mine' });
    const s2 = makeSession('ws-other', { id: 'sess-theirs' });
    repo.create(s1);
    repo.create(s2);

    const sessions = repo.listByWorkspace(workspaceId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('sess-mine');
  });

  test('updateStatus() changes status and updatedAt', () => {
    const session = makeSession(workspaceId, { id: 'sess-1' });
    repo.create(session);

    repo.updateStatus('sess-1', 'busy');
    const updated = repo.findById('sess-1');
    expect(updated!.status).toBe('busy');
    // updatedAt should have changed
    expect(updated!.updatedAt).not.toBe(session.updatedAt);
  });

  test('updateTitle()', () => {
    const session = makeSession(workspaceId, { id: 'sess-1', title: 'Old Title' });
    repo.create(session);

    repo.updateTitle('sess-1', 'New Title');
    expect(repo.findById('sess-1')!.title).toBe('New Title');
  });

  test('updateSummary()', () => {
    const session = makeSession(workspaceId, { id: 'sess-1' });
    repo.create(session);
    expect(repo.findById('sess-1')!.summaryText).toBeNull();

    repo.updateSummary('sess-1', 'This session discussed persistence.');
    expect(repo.findById('sess-1')!.summaryText).toBe('This session discussed persistence.');
  });

  test('delete() removes session', () => {
    const session = makeSession(workspaceId, { id: 'sess-1' });
    repo.create(session);
    expect(repo.findById('sess-1')).not.toBeNull();

    repo.delete('sess-1');
    expect(repo.findById('sess-1')).toBeNull();
  });

  test('foreign key: creating session with non-existent workspaceId fails', () => {
    const session = makeSession('non-existent-ws');
    expect(() => repo.create(session)).toThrow();
  });
});

// ── MessageRepository Tests ──────────────────────────────────────────────────

describe('MessageRepository', () => {
  let db: Database;
  let repo: MessageRepository;
  let sessionId: string;

  beforeEach(() => {
    db = freshDb();
    const wsRepo = new WorkspaceRepository(db);
    const sessRepo = new SessionRepository(db);
    repo = new MessageRepository(db);

    const ws = makeWorkspace({ id: 'ws-1', rootPath: '/test' });
    wsRepo.create(ws);

    const session = makeSession('ws-1', { id: 'sess-1' });
    sessRepo.create(session);
    sessionId = 'sess-1';
  });

  test('createMessage() and getSessionMessages()', () => {
    const msg = makeMessage(sessionId, 0, { id: 'msg-1', role: 'user' });
    repo.createMessage(msg);

    const messages = repo.getSessionMessages(sessionId);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('msg-1');
    expect(messages[0].role).toBe('user');
    expect(messages[0].index).toBe(0);
    expect(messages[0].parts).toEqual([]);
  });

  test('messages are ordered by index ASC', () => {
    repo.createMessage(makeMessage(sessionId, 2, { id: 'msg-3' }));
    repo.createMessage(makeMessage(sessionId, 0, { id: 'msg-1' }));
    repo.createMessage(makeMessage(sessionId, 1, { id: 'msg-2' }));

    const messages = repo.getSessionMessages(sessionId);
    expect(messages.map((m) => m.id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
  });

  test('addPart() attaches parts to a message', () => {
    const msg = makeMessage(sessionId, 0, { id: 'msg-1' });
    repo.createMessage(msg);

    const part = makeTextPart(0, 'Hello world');
    part.messageId = 'msg-1';
    repo.addPart(part);

    const messages = repo.getSessionMessages(sessionId);
    expect(messages[0].parts).toHaveLength(1);
    expect(messages[0].parts[0].type).toBe('text');
    expect((messages[0].parts[0] as any).text).toBe('Hello world');
  });

  test('addPart() with INSERT OR REPLACE upserts existing parts', () => {
    const msg = makeMessage(sessionId, 0, { id: 'msg-1' });
    repo.createMessage(msg);

    const part = makeTextPart(0, 'Initial text');
    part.messageId = 'msg-1';
    repo.addPart(part);

    // Upsert the same part with updated text
    const updatedPart = { ...part, text: 'Updated text' };
    repo.addPart(updatedPart);

    const parts = repo.getMessageParts('msg-1');
    expect(parts).toHaveLength(1);
    expect((parts[0] as any).text).toBe('Updated text');
  });

  test('addPart() supports multiple parts per message', () => {
    const msg = makeMessage(sessionId, 0, { id: 'msg-1' });
    repo.createMessage(msg);

    const part1 = makeTextPart(0, 'First');
    part1.messageId = 'msg-1';
    const part2 = makeTextPart(1, 'Second');
    part2.messageId = 'msg-1';

    repo.addPart(part1);
    repo.addPart(part2);

    const parts = repo.getMessageParts('msg-1');
    expect(parts).toHaveLength(2);
    expect((parts[0] as any).text).toBe('First');
    expect((parts[1] as any).text).toBe('Second');
  });

  test('createMessage() persists usage and error JSON', () => {
    const msg = makeMessage(sessionId, 0, {
      id: 'msg-1',
      role: 'assistant',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      error: { code: 'rate_limit', message: 'Too many requests' },
    });
    repo.createMessage(msg);

    const messages = repo.getSessionMessages(sessionId);
    expect(messages[0].usage).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
    expect(messages[0].error).toEqual({ code: 'rate_limit', message: 'Too many requests' });
  });

  test('createMessage() handles null usage and error', () => {
    const msg = makeMessage(sessionId, 0, { id: 'msg-1' });
    repo.createMessage(msg);

    const messages = repo.getSessionMessages(sessionId);
    expect(messages[0].usage).toBeNull();
    expect(messages[0].error).toBeNull();
  });

  test('updateFinishReason()', () => {
    const msg = makeMessage(sessionId, 0, { id: 'msg-1', role: 'assistant' });
    repo.createMessage(msg);

    repo.updateFinishReason('msg-1', 'stop', JSON.stringify({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }));

    const messages = repo.getSessionMessages(sessionId);
    expect(messages[0].finishReason).toBe('stop');
    expect(messages[0].usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  test('updateFinishReason() without usage leaves existing usage intact', () => {
    const msg = makeMessage(sessionId, 0, {
      id: 'msg-1',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    repo.createMessage(msg);

    repo.updateFinishReason('msg-1', 'stop');

    const messages = repo.getSessionMessages(sessionId);
    expect(messages[0].finishReason).toBe('stop');
    expect(messages[0].usage).toEqual({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
  });

  test('deleteSessionMessages() removes all messages for a session', () => {
    repo.createMessage(makeMessage(sessionId, 0, { id: 'msg-1' }));
    repo.createMessage(makeMessage(sessionId, 1, { id: 'msg-2' }));

    expect(repo.getSessionMessages(sessionId)).toHaveLength(2);

    repo.deleteSessionMessages(sessionId);
    expect(repo.getSessionMessages(sessionId)).toHaveLength(0);
  });

  test('cascade: deleting messages also deletes their parts', () => {
    repo.createMessage(makeMessage(sessionId, 0, { id: 'msg-1' }));
    const part = makeTextPart(0, 'hello');
    part.messageId = 'msg-1';
    repo.addPart(part);

    expect(repo.getMessageParts('msg-1')).toHaveLength(1);

    // Delete message directly via SQL to test cascade
    db.prepare('DELETE FROM messages WHERE id = ?').run('msg-1');
    expect(repo.getMessageParts('msg-1')).toHaveLength(0);
  });
});

// ── ConfigRepository Tests ───────────────────────────────────────────────────

describe('ConfigRepository', () => {
  let db: Database;
  let wsRepo: WorkspaceRepository;
  let repo: ConfigRepository;
  let workspaceId: string;

  beforeEach(() => {
    db = freshDb();
    wsRepo = new WorkspaceRepository(db);
    repo = new ConfigRepository(db);

    const ws = makeWorkspace({ id: 'ws-cfg' });
    wsRepo.create(ws);
    workspaceId = ws.id;
  });

  test('getWorkspaceConfig() returns default config after workspace creation', () => {
    const config = repo.getWorkspaceConfig(workspaceId);
    expect(config).toEqual({});
  });

  test('getWorkspaceConfig() returns null for non-existent workspace', () => {
    expect(repo.getWorkspaceConfig('no-such-ws')).toBeNull();
  });

  test('setWorkspaceConfig() updates config', () => {
    repo.setWorkspaceConfig(workspaceId, { model: 'gpt-4', temperature: 0.7 });

    const config = repo.getWorkspaceConfig(workspaceId);
    expect(config).toEqual({ model: 'gpt-4', temperature: 0.7 });
  });

  test('setWorkspaceConfig() replaces previous config entirely', () => {
    repo.setWorkspaceConfig(workspaceId, { a: 1, b: 2 });
    repo.setWorkspaceConfig(workspaceId, { c: 3 });

    const config = repo.getWorkspaceConfig(workspaceId);
    expect(config).toEqual({ c: 3 });
    expect(config).not.toHaveProperty('a');
    expect(config).not.toHaveProperty('b');
  });
});

// ── Cross-repository Integration Tests ───────────────────────────────────────

describe('Cross-repository integration', () => {
  let db: Database;

  beforeEach(() => {
    db = freshDb();
  });

  test('full lifecycle: create workspace -> session -> messages -> parts -> query', () => {
    const wsRepo = new WorkspaceRepository(db);
    const sessRepo = new SessionRepository(db);
    const msgRepo = new MessageRepository(db);

    // Create workspace
    const ws = makeWorkspace({ id: 'ws-1', rootPath: '/project' });
    wsRepo.create(ws);

    // Create session
    const session = makeSession('ws-1', { id: 'sess-1' });
    sessRepo.create(session);

    // Create user message with text part
    const userMsg = makeMessage('sess-1', 0, { id: 'msg-user', role: 'user' });
    msgRepo.createMessage(userMsg);
    const userPart = makeTextPart(0, 'What is 2+2?');
    userPart.messageId = 'msg-user';
    msgRepo.addPart(userPart);

    // Create assistant message with text part
    const assistantMsg = makeMessage('sess-1', 1, { id: 'msg-asst', role: 'assistant', modelId: 'gpt-4' });
    msgRepo.createMessage(assistantMsg);
    const asstPart = makeTextPart(0, 'The answer is 4.');
    asstPart.messageId = 'msg-asst';
    msgRepo.addPart(asstPart);

    // Query it all back
    const messages = msgRepo.getSessionMessages('sess-1');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[0].parts).toHaveLength(1);
    expect((messages[0].parts[0] as any).text).toBe('What is 2+2?');
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].modelId).toBe('gpt-4');
    expect((messages[1].parts[0] as any).text).toBe('The answer is 4.');
  });

  test('cascade delete: deleting workspace cascades to sessions', () => {
    const wsRepo = new WorkspaceRepository(db);
    const sessRepo = new SessionRepository(db);

    wsRepo.create(makeWorkspace({ id: 'ws-1', rootPath: '/project' }));
    sessRepo.create(makeSession('ws-1', { id: 'sess-1' }));
    sessRepo.create(makeSession('ws-1', { id: 'sess-2' }));

    expect(sessRepo.listByWorkspace('ws-1')).toHaveLength(2);

    wsRepo.delete('ws-1');
    expect(sessRepo.listByWorkspace('ws-1')).toHaveLength(0);
    expect(sessRepo.findById('sess-1')).toBeNull();
  });

  test('cascade delete: deleting session cascades to messages and parts', () => {
    const wsRepo = new WorkspaceRepository(db);
    const sessRepo = new SessionRepository(db);
    const msgRepo = new MessageRepository(db);

    wsRepo.create(makeWorkspace({ id: 'ws-1', rootPath: '/project' }));
    sessRepo.create(makeSession('ws-1', { id: 'sess-1' }));

    const msg = makeMessage('sess-1', 0, { id: 'msg-1' });
    msgRepo.createMessage(msg);
    const part = makeTextPart(0, 'hello');
    part.messageId = 'msg-1';
    msgRepo.addPart(part);

    // Verify data exists
    expect(msgRepo.getSessionMessages('sess-1')).toHaveLength(1);
    expect(msgRepo.getMessageParts('msg-1')).toHaveLength(1);

    // Delete session -> should cascade
    sessRepo.delete('sess-1');
    expect(msgRepo.getSessionMessages('sess-1')).toHaveLength(0);
    expect(msgRepo.getMessageParts('msg-1')).toHaveLength(0);
  });

});
