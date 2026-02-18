/**
 * EventStore -- normalized store keyed by [workspaceId][sessionId].
 *
 * Zero awareness of SSE mechanics.
 * Updated by the SSE pipe. Read by React hooks via useSyncExternalStore.
 *
 * IMPORTANT: After every mutation, the SessionState object is shallow-cloned
 * so that useSyncExternalStore sees a new reference and triggers React re-renders.
 * Reducers use immutable updates: modified messages/parts get new object
 * references while unmodified items keep their old references, enabling
 * efficient React.memo usage downstream.
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
  applyFilePatch,
  applyCompactionStart,
  applyCompactionDone,
  applyContextPruned,
  applySubagentStart,
  applySubagentChildEvent,
  applySubagentDone,
  applyBashOutput,
} from './reducers';
import type { ChildSessionState } from './reducers';

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
  /** Cumulative token usage across all messages in this session. */
  cumulativeUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
  /** Cumulative cost across all messages in this session. */
  cumulativeCost: number;
  /** Last error that occurred in this session */
  lastError?: { code: string; message: string };
  /** Retry info when status is 'retry' */
  retryInfo?: { attempt: number; reason: string; nextAt: number };
  /** Auto-generated session title (set by title agent) */
  title?: string;
  /** Child session state per subagent toolCallId (for live streaming UI). */
  childSessions?: Map<string, ChildSessionState>;
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
    cumulativeUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    cumulativeCost: 0,
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
    case 'file-patch':        return applyFilePatch(session, event);
    case 'tool-call-start':   return applyToolCallStart(session, event);
    case 'tool-call-delta':   return applyToolCallDelta(session, event);
    case 'tool-call-done':    return applyToolCallDone(session, event);
    case 'tool-result':       return applyToolResult(session, event);
    case 'tool-error':        return applyToolError(session, event);
    case 'permission-request':  return applyPermissionRequest(session, event);
    case 'permission-response': return applyPermissionResponse(session, event);
    case 'compaction-start':  return applyCompactionStart(session, event);
    case 'compaction-done':   return applyCompactionDone(session, event);
    case 'context-pruned':    return applyContextPruned(session, event);
    case 'error':             return applyError(session, event);
    case 'session-title-updated':
      session.title = event.title;
      return;
    case 'subagent-start':      return applySubagentStart(session, event);
    case 'subagent-child-event': return applySubagentChildEvent(session, event);
    case 'subagent-done':       return applySubagentDone(session, event);
    case 'bash-output':         return applyBashOutput(session, event);
  }
}

// ---------------------------------------------------------------------------
//  EventStore class
// ---------------------------------------------------------------------------

export class EventStore {
  private state = new Map<string, WorkspaceState>();
  /** Global listeners (notified on any change) */
  private listeners = new Set<() => void>();
  /** Per-session listeners (notified only when that session changes) */
  private sessionListeners = new Map<string, Set<() => void>>();
  /** Per-workspace listeners (notified when any session in that workspace changes) */
  private workspaceListeners = new Map<string, Set<() => void>>();

  /** Called by SSE pipe for every incoming event -- no filtering */
  append(event: StreamEvent): void {
    const ws = this.getOrCreateWorkspace(event.workspaceId);
    const sess = this.getOrCreateSession(ws, event.sessionId);

    applyEvent(sess, event);

    // Break reference: new object so useSyncExternalStore triggers re-render.
    ws.sessions.set(event.sessionId, { ...sess });

    this.notifySession(event.workspaceId, event.sessionId);
    this.notifyWorkspace(event.workspaceId);
    this.notifyGlobal();
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

    // Notify per-session and per-workspace listeners for modified sessions
    const modifiedWorkspaces = new Set<string>();
    for (const key of modified) {
      const [wsId, sessId] = key.split(':');
      this.notifySession(wsId, sessId);
      modifiedWorkspaces.add(wsId);
    }
    for (const wsId of modifiedWorkspaces) {
      this.notifyWorkspace(wsId);
    }
    // Notify global listeners once
    this.notifyGlobal();
  }

  /**
   * Optimistically insert a user message into the store immediately,
   * before the SSE round-trip delivers the server-confirmed events.
   */
  appendOptimisticMessage(workspaceId: string, sessionId: string, message: UIMessage): void {
    const ws = this.getOrCreateWorkspace(workspaceId);
    const sess = this.getOrCreateSession(ws, sessionId);
    // Immutable: new messages array
    sess.messages = [...sess.messages, message];
    sess.messageIndex.set(message.id, message);
    ws.sessions.set(sessionId, { ...sess });
    this.notifySession(workspaceId, sessionId);
    this.notifyGlobal();
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
      cumulativeUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cumulativeCost: 0,
    });
    this.notifySession(workspaceId, sessionId);
    this.notifyGlobal();
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
      this.notifySession(workspaceId, sessionId);
      this.notifyGlobal();
    }
  }

  /** For useSyncExternalStore -- global subscription (all changes) */
  subscribe = (callback: () => void): (() => void) => {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  };

  /**
   * Per-session subscription: callback fires only when the specified
   * session changes. Used by useSessionMessages for scoped re-renders.
   */
  subscribeSession = (
    workspaceId: string,
    sessionId: string,
    callback: () => void,
  ): (() => void) => {
    const key = `${workspaceId}:${sessionId}`;
    let set = this.sessionListeners.get(key);
    if (!set) {
      set = new Set();
      this.sessionListeners.set(key, set);
    }
    set.add(callback);

    return () => {
      const s = this.sessionListeners.get(key);
      if (s) {
        s.delete(callback);
        if (s.size === 0) this.sessionListeners.delete(key);
      }
    };
  };

  /**
   * Per-workspace subscription: callback fires when any session in the
   * specified workspace changes. Used by useLiveSessionStatuses for
   * scoped re-renders (avoids global listener spam from other workspaces).
   */
  subscribeWorkspace = (
    workspaceId: string,
    callback: () => void,
  ): (() => void) => {
    let set = this.workspaceListeners.get(workspaceId);
    if (!set) {
      set = new Set();
      this.workspaceListeners.set(workspaceId, set);
    }
    set.add(callback);

    return () => {
      const s = this.workspaceListeners.get(workspaceId);
      if (s) {
        s.delete(callback);
        if (s.size === 0) this.workspaceListeners.delete(workspaceId);
      }
    };
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

  /** Notify only listeners subscribed to a specific session */
  private notifySession(workspaceId: string, sessionId: string): void {
    const key = `${workspaceId}:${sessionId}`;
    const set = this.sessionListeners.get(key);
    if (set) {
      for (const listener of set) listener();
    }
  }

  /** Notify listeners subscribed to a specific workspace */
  private notifyWorkspace(workspaceId: string): void {
    const set = this.workspaceListeners.get(workspaceId);
    if (set) {
      for (const listener of set) listener();
    }
  }

  /** Notify global listeners (for components that watch all sessions) */
  private notifyGlobal(): void {
    for (const listener of this.listeners) listener();
  }
}
