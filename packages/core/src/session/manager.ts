/**
 * SessionManager -- CRUD for sessions within a workspace.
 *
 * Optionally persists session state to SQLite via SessionRepository
 * and loads messages via MessageRepository.
 */

import { generateSessionId } from '@coding-assistant/shared';
import type { SessionInfo, SessionStatus, Message } from '@coding-assistant/shared';
import type { WorkspaceContext } from '../workspace/context.js';
import { SessionContext } from './context.js';
import { TimelinePersistenceListener } from './timeline-persistence.js';
import { globalEventBus } from '../events/bus.js';
import { mapError } from '../execution/stream-mapper.js';

/** Repository interface -- matches SessionRepository from packages/server/persistence */
export interface SessionRepo {
  create(session: SessionInfo): void;
  findById(id: string): SessionInfo | null;
  listByWorkspace(workspaceId: string): SessionInfo[];
  updateStatus(id: string, status: SessionStatus): void;
  updateTitle(id: string, title: string): void;
  delete(id: string): void;
}

/** Repository interface -- matches MessageRepository from packages/server/persistence */
export interface MessageRepo {
  createMessage(message: Omit<Message, 'parts'>): void;
  addPart(part: import('@coding-assistant/shared').MessagePart & { messageId: string; sessionId?: string }): void;
  batchAddParts(parts: Array<{ messageId: string; sessionId?: string; part: import('@coding-assistant/shared').MessagePart }>): void;
  getSessionMessages(sessionId: string): Message[];
  deleteSessionMessages(sessionId: string): void;
  getMessageCount(sessionId: string): number;
}

export class SessionManager {
  private sessionRepo: SessionRepo | null;
  private messageRepo: MessageRepo | null;

  constructor(sessionRepo?: SessionRepo, messageRepo?: MessageRepo) {
    this.sessionRepo = sessionRepo ?? null;
    this.messageRepo = messageRepo ?? null;
  }

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

    // Persist the session
    if (this.sessionRepo) {
      try {
        this.sessionRepo.create({
          id: session.id,
          workspaceId: workspace.id,
          title: 'New Session',
          status: session.state.status,
          agentId: session.agentId,
          parentSessionId: null,
          forkMessageIndex: null,
          summaryText: null,
          createdAt: session.createdAt,
          updatedAt: session.createdAt,
        });
      } catch (err) {
        console.error(`[session-manager] Failed to persist session "${session.id}":`, err);
        globalEventBus.emit(mapError(
          { workspaceId: workspace.id, sessionId: session.id },
          'PERSISTENCE_ERROR',
          `Failed to persist session: ${err instanceof Error ? err.message : String(err)}`,
        ));
      }
    }

    // Wire up message persistence listener
    this.attachPersistenceListener(session);

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
   * Update a session's title (both in-memory and persisted).
   */
  updateTitle(workspace: WorkspaceContext, sessionId: string, title: string): void {
    const session = workspace.sessions.get(sessionId);
    if (session) {
      session.title = title;
    }
    if (this.sessionRepo) {
      try {
        this.sessionRepo.updateTitle(sessionId, title);
      } catch (err) {
        console.error(`[session-manager] Failed to persist title for "${sessionId}":`, err);
      }
    }
  }

  /**
   * Archive/close a session.
   */
  close(workspace: WorkspaceContext, sessionId: string): void {
    const session = workspace.sessions.get(sessionId);
    if (session) {
      session[Symbol.dispose]();
      workspace.sessions.delete(sessionId);

      // Persist status change (mark as idle, keep in DB for future restoration)
      if (this.sessionRepo) {
        try {
          this.sessionRepo.updateStatus(sessionId, 'idle');
        } catch (err) {
          console.error(`[session-manager] Failed to persist session close "${sessionId}":`, err);
        }
      }
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

    // Persist forked session
    if (this.sessionRepo) {
      try {
        this.sessionRepo.create({
          id: forked.id,
          workspaceId: workspace.id,
          title: 'Forked Session',
          status: forked.state.status,
          agentId: forked.agentId,
          parentSessionId: sourceSession.id,
          forkMessageIndex: atMessageIndex,
          summaryText: null,
          createdAt: forked.createdAt,
          updatedAt: forked.createdAt,
        });
      } catch (err) {
        console.error(`[session-manager] Failed to persist forked session "${forked.id}":`, err);
        globalEventBus.emit(mapError(
          { workspaceId: workspace.id, sessionId: forked.id },
          'PERSISTENCE_ERROR',
          `Failed to persist forked session: ${err instanceof Error ? err.message : String(err)}`,
        ));
      }
    }

    // Wire up message persistence listener
    this.attachPersistenceListener(forked);

    return forked;
  }

  /**
   * Restore all persisted sessions for a workspace.
   * Called during server startup after workspaces are restored.
   * Loads messages from MessageRepository into each session's timeline.
   */
  restoreForWorkspace(workspace: WorkspaceContext): void {
    if (!this.sessionRepo) return;

    const persisted = this.sessionRepo.listByWorkspace(workspace.id);
    for (const info of persisted) {
      try {
        const session = new SessionContext({
          id: info.id,
          workspace,
          agentId: info.agentId,
          createdAt: info.createdAt,
          title: info.title,
        });

        // Defer message loading -- messages are loaded lazily on first access
        if (this.messageRepo) {
          const messageRepo = this.messageRepo;
          const sessionId = info.id;
          session.timeline.setLazyLoader(() => messageRepo.getSessionMessages(sessionId));
          // Set cached message count without triggering lazy message load
          session.messageCount = messageRepo.getMessageCount(sessionId);
        }

        workspace.sessions.set(session.id, session);

        // Wire up message persistence listener for future mutations
        this.attachPersistenceListener(session);
      } catch (err) {
        console.warn(
          `[session-manager] Could not restore session "${info.id}": ${err}`,
        );
      }
    }
  }

  /**
   * Create a subagent session (DB-backed, linked to parent).
   *
   * Unlike `create()`, this sets `parentSessionId` and `isSubagent` on the session,
   * and does NOT add it to `workspace.sessions` (it's transient -- only the subagent tool holds a reference).
   */
  createSubagentSession(
    workspace: WorkspaceContext,
    parentSessionId: string,
    agentId: string,
  ): SessionContext {
    const session = new SessionContext({
      id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      workspace,
      agentId,
      isSubagent: true,
      deniedToolCategories: ['agent'],
    });

    // Persist the subagent session with parent link
    if (this.sessionRepo) {
      try {
        this.sessionRepo.create({
          id: session.id,
          workspaceId: workspace.id,
          title: `Subagent (${agentId})`,
          status: session.state.status,
          agentId,
          parentSessionId,
          forkMessageIndex: null,
          summaryText: null,
          createdAt: session.createdAt,
          updatedAt: session.createdAt,
        });
      } catch (err) {
        console.error(`[session-manager] Failed to persist subagent session "${session.id}":`, err);
      }
    }

    // Wire up message persistence
    this.attachPersistenceListener(session);

    return session;
  }

  /**
   * Restore a subagent session for resumption via task_id.
   * Loads the session from the database and its persisted messages into the timeline.
   */
  restoreSubagentSession(
    workspace: WorkspaceContext,
    sessionId: string,
  ): SessionContext | null {
    if (!this.sessionRepo) return null;

    const info = this.sessionRepo.findById(sessionId);
    if (!info || info.workspaceId !== workspace.id) return null;

    const session = new SessionContext({
      id: info.id,
      workspace,
      agentId: info.agentId,
      createdAt: info.createdAt,
      title: info.title,
      isSubagent: true,
      deniedToolCategories: ['agent'],
    });

    // Load persisted messages into timeline
    if (this.messageRepo) {
      const messages = this.messageRepo.getSessionMessages(info.id);
      if (messages.length > 0) {
        session.timeline.loadFromPersisted(messages);
      }
    }

    // Wire up message persistence for future mutations
    this.attachPersistenceListener(session);

    return session;
  }

  /**
   * Attach a timeline persistence listener to a session.
   * Subscribes to timeline mutations and writes them to the message repository.
   */
  private attachPersistenceListener(session: SessionContext): void {
    if (!this.messageRepo) return;

    const listener = new TimelinePersistenceListener(
      session.id,
      this.messageRepo,
    );
    session.timeline.onMutation(listener.handleMutation);

    // Increment in-memory message count on new messages
    session.timeline.onMutation((event) => {
      if (event.type === 'message-appended') {
        session.messageCount++;
      }
    });
  }
}
