/**
 * Server service locator -- holds initialized singletons.
 *
 * Initialized in index.ts before createApp() is called.
 * Routes import from here instead of creating their own instances.
 */

import type { WorkspaceManager, SessionManager, ReplayLog } from '@coding-assistant/core';
import type { MessageRepository } from './persistence/repositories/message-repo.js';
import { PermissionRequestStore } from './services/permission-requests.js';

let _workspaceManager: WorkspaceManager | null = null;
let _sessionManager: SessionManager | null = null;
let _replayLog: ReplayLog | null = null;
let _messageRepo: MessageRepository | null = null;

// Permission request store is created eagerly -- it has no external dependencies.
const _permissionRequestStore = new PermissionRequestStore();

export function initServices(
  workspaceManager: WorkspaceManager,
  sessionManager: SessionManager,
  replayLog: ReplayLog,
  messageRepo: MessageRepository,
): void {
  _workspaceManager = workspaceManager;
  _sessionManager = sessionManager;
  _replayLog = replayLog;
  _messageRepo = messageRepo;
}

export function getWorkspaceManager(): WorkspaceManager {
  if (!_workspaceManager) throw new Error('Services not initialized -- call initServices() first');
  return _workspaceManager;
}

export function getSessionManager(): SessionManager {
  if (!_sessionManager) throw new Error('Services not initialized -- call initServices() first');
  return _sessionManager;
}

export function getReplayLog(): ReplayLog {
  if (!_replayLog) throw new Error('Services not initialized -- call initServices() first');
  return _replayLog;
}

export function getMessageRepo(): MessageRepository {
  if (!_messageRepo) throw new Error('Services not initialized -- call initServices() first');
  return _messageRepo;
}

export function getPermissionRequestStore(): PermissionRequestStore {
  return _permissionRequestStore;
}
