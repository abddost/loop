/**
 * SessionManager -- CRUD for sessions within a workspace.
 */

import { generateSessionId } from '@coding-assistant/shared';
import type { WorkspaceContext } from '../workspace/context.js';
import { SessionContext } from './context.js';

export class SessionManager {
  /**
   * Create a new session within a workspace.
   */
  create(workspace: WorkspaceContext, agentId: string = 'build'): SessionContext {
    const session = new SessionContext({
      id: generateSessionId(),
      workspace,
      agentId,
    });
    workspace.sessions.set(session.id, session);
    return session;
  }

  /**
   * Get a session by ID from a workspace.
   */
  get(workspace: WorkspaceContext, sessionId: string): SessionContext | undefined {
    return workspace.sessions.get(sessionId);
  }

  /**
   * List all sessions in a workspace.
   */
  list(workspace: WorkspaceContext): SessionContext[] {
    return Array.from(workspace.sessions.values());
  }

  /**
   * Archive/close a session.
   */
  close(workspace: WorkspaceContext, sessionId: string): void {
    const session = workspace.sessions.get(sessionId);
    if (session) {
      session[Symbol.dispose]();
      workspace.sessions.delete(sessionId);
    }
  }

  /**
   * Fork a session at a specific message index.
   */
  fork(
    workspace: WorkspaceContext,
    sourceSession: SessionContext,
    atMessageIndex: number,
  ): SessionContext {
    const forked = new SessionContext({
      id: generateSessionId(),
      workspace,
      agentId: sourceSession.agentId,
    });

    // Copy messages up to the fork point
    const messages = sourceSession.timeline.messages.slice(0, atMessageIndex + 1);
    forked.timeline.loadFromPersisted([...messages]);

    workspace.sessions.set(forked.id, forked);
    return forked;
  }
}
