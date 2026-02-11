/**
 * EventStore -- normalized store keyed by [workspaceId][sessionId].
 *
 * Zero awareness of SSE mechanics.
 * Updated by the SSE pipe. Read by React hooks via useSyncExternalStore.
 *
 * IMPORTANT: After every mutation, the SessionState object is shallow-cloned
 * so that useSyncExternalStore sees a new reference and triggers React re-renders.
 *
 * Event processing is delegated to focused reducer modules in ./reducers/.
 */

import type {
  StreamEvent,
  SessionStatus,
  UIMessage,
  PermissionRequest,
  FinishReason,
  TokenUsage,
} from '@coding-assistant/shared';

import {
  applySessionStatus,
  applyMessageStart,
  applyMessageDone,
  applyTextStart,
  applyTextDelta,
  applyTextDone,
  applyReasoningStart,
  applyReasoningDelta,
  applyReasoningDone,
  applyStepStart,
  applyStepFinish,
  applyToolCallStart,
  applyToolCallDelta,
  applyToolCallDone,
  applyToolResult,
  applyToolError,
  applyPermissionRequest,
  applyPermissionResponse,
  applyError,
} from './reducers';

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

/** Typed metadata for message-done events (replaces ad-hoc untyped properties). */
export interface MessageMetadata {
  finishReason: FinishReason;
  usage: TokenUsage | null;
  totalCost?: number;
}

export type SessionState = {
  status: SessionStatus;
  messages: UIMessage[];
  messageIndex: Map<string, UIMessage>;
  pendingPermissions: PermissionRequest[];
  /** Typed metadata per message (finishReason, usage, cost). */
  messageMetadata: Map<string, MessageMetadata>;
  /** Last error that occurred in this session */
  lastError?: { code: string; message: string };
  /** Retry info when status is 'retry' */
  retryInfo?: { attempt: number; reason: string; nextAt: number };
};

type WorkspaceState = {
  sessions: Map<string, SessionState>;
};

function createEmptySession(): SessionState {
  return {
    status: 'idle',
    messages: [],
    messageIndex: new Map(),
    pendingPermissions: [],
    messageMetadata: new Map(),
  };
}

// ---------------------------------------------------------------------------
//  Event dispatcher
// ---------------------------------------------------------------------------

/**
 * Apply an event to a session state by delegating to the appropriate reducer.
 * Mutates the session in place -- the caller is responsible for
 * creating a new reference to trigger external store notifications.
 */
function applyEvent(session: SessionState, event: StreamEvent): void {
  switch (event.type) {
    case 'session-status':    return applySessionStatus(session, event);
    case 'message-start':     return applyMessageStart(session, event);
    case 'message-done':      return applyMessageDone(session, event);
    case 'text-start':        return applyTextStart(session, event);
    case 'text-delta':        return applyTextDelta(session, event);
    case 'text-done':         return applyTextDone(session, event);
    case 'reasoning-start':   return applyReasoningStart(session, event);
    case 'reasoning-delta':   return applyReasoningDelta(session, event);
    case 'reasoning-done':    return applyReasoningDone(session, event);
    case 'step-start':        return applyStepStart(session, event);
    case 'step-finish':       return applyStepFinish(session, event);
    case 'tool-call-start':   return applyToolCallStart(session, event);
    case 'tool-call-delta':   return applyToolCallDelta(session, event);
    case 'tool-call-done':    return applyToolCallDone(session, event);
    case 'tool-result':       return applyToolResult(session, event);
    case 'tool-error':        return applyToolError(session, event);
    case 'permission-request':  return applyPermissionRequest(session, event);
    case 'permission-response': return applyPermissionResponse(session, event);
    case 'error':             return applyError(session, event);
  }
}

// ---------------------------------------------------------------------------
//  EventStore class
// ---------------------------------------------------------------------------

export class EventStore {
  private state = new Map<string, WorkspaceState>();
  private listeners = new Set<() => void>();

  /** Called by SSE pipe for every incoming event -- no filtering */
  append(event: StreamEvent): void {
    const ws = this.getOrCreateWorkspace(event.workspaceId);
    const sess = this.getOrCreateSession(ws, event.sessionId);

    applyEvent(sess, event);

    // Break reference: new object so useSyncExternalStore triggers re-render.
    ws.sessions.set(event.sessionId, { ...sess });

    this.notify();
  }

  /**
   * Process a batch of events with a single React notification.
   * Used by the SSE pipe's 16ms batching to reduce re-renders.
   */
  appendBatch(events: StreamEvent[]): void {
    if (events.length === 0) return;

    // Track which sessions were modified
    const modified = new Set<string>();

    for (const event of events) {
      const ws = this.getOrCreateWorkspace(event.workspaceId);
      const sess = this.getOrCreateSession(ws, event.sessionId);
      applyEvent(sess, event);
      modified.add(`${event.workspaceId}:${event.sessionId}`);
    }

    // Break references for all modified sessions (single pass)
    for (const key of modified) {
      const [wsId, sessId] = key.split(':');
      const ws = this.state.get(wsId);
      if (ws) {
        const sess = ws.sessions.get(sessId);
        if (sess) {
          ws.sessions.set(sessId, { ...sess });
        }
      }
    }

    // Single notification for the entire batch
    this.notify();
  }

  /**
   * Optimistically insert a user message into the store immediately,
   * before the SSE round-trip delivers the server-confirmed events.
   */
  appendOptimisticMessage(workspaceId: string, sessionId: string, message: UIMessage): void {
    const ws = this.getOrCreateWorkspace(workspaceId);
    const sess = this.getOrCreateSession(ws, sessionId);
    sess.messages.push(message);
    sess.messageIndex.set(message.id, message);
    ws.sessions.set(sessionId, { ...sess });
    this.notify();
  }

  /**
   * Hydrate a session with historical messages loaded from the server.
   * Replaces any existing session data for the given ids.
   */
  hydrateSession(workspaceId: string, sessionId: string, messages: UIMessage[]): void {
    const ws = this.getOrCreateWorkspace(workspaceId);
    const messageIndex = new Map(messages.map((m) => [m.id, m]));
    ws.sessions.set(sessionId, {
      status: 'idle',
      messages: [...messages],
      messageIndex,
      pendingPermissions: [],
      messageMetadata: new Map(),
    });
    this.notify();
  }

  /**
   * Clear a session's data from memory.
   * Call when sessions are deleted or workspaces closed.
   */
  clearSession(workspaceId: string, sessionId: string): void {
    const ws = this.state.get(workspaceId);
    if (ws) {
      ws.sessions.delete(sessionId);
      if (ws.sessions.size === 0) {
        this.state.delete(workspaceId);
      }
      this.notify();
    }
  }

  /** For useSyncExternalStore */
  subscribe = (callback: () => void): (() => void) => {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  };

  /** Snapshot for a specific session */
  getSession(workspaceId: string, sessionId: string): SessionState | undefined {
    return this.state.get(workspaceId)?.sessions.get(sessionId);
  }

  /** Snapshot for a workspace's session list */
  getWorkspaceSessions(workspaceId: string): Map<string, SessionState> | undefined {
    return this.state.get(workspaceId)?.sessions;
  }

  private getOrCreateWorkspace(id: string): WorkspaceState {
    let ws = this.state.get(id);
    if (!ws) {
      ws = { sessions: new Map() };
      this.state.set(id, ws);
    }
    return ws;
  }

  private getOrCreateSession(ws: WorkspaceState, id: string): SessionState {
    let sess = ws.sessions.get(id);
    if (!sess) {
      sess = createEmptySession();
      ws.sessions.set(id, sess);
    }
    return sess;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
