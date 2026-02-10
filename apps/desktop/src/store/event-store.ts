/**
 * EventStore -- normalized store keyed by [workspaceId][sessionId].
 *
 * Zero awareness of SSE mechanics.
 * Updated by the SSE pipe. Read by React hooks via useSyncExternalStore.
 */

import type {
  StreamEvent,
  SessionStatus,
  UIMessage,
  PermissionRequest,
  MessagePart,
} from '@coding-assistant/shared';

export type SessionState = {
  status: SessionStatus;
  messages: UIMessage[];
  pendingPermissions: PermissionRequest[];
};

type WorkspaceState = {
  sessions: Map<string, SessionState>;
};

function createEmptySession(): SessionState {
  return {
    status: 'idle',
    messages: [],
    pendingPermissions: [],
  };
}

/**
 * Apply an event to a session state (pure reducer logic).
 */
function applyEvent(session: SessionState, event: StreamEvent): void {
  switch (event.type) {
    case 'session-status':
      session.status = event.status as SessionStatus;
      break;

    case 'message-start': {
      session.messages.push({
        id: event.messageId,
        role: event.role,
        parts: [],
        modelId: null,
        createdAt: event.timestamp,
      });
      break;
    }

    case 'text-delta': {
      const msg = session.messages.find((m) => m.id === event.messageId);
      if (!msg) break;
      const textPart = msg.parts.find((p): p is MessagePart & { type: 'text' } => p.type === 'text');
      if (textPart && textPart.type === 'text') {
        (textPart as { text: string }).text += event.delta;
      } else {
        msg.parts.push({
          type: 'text',
          id: `part_${Date.now()}`,
          index: msg.parts.length,
          text: event.delta,
        });
      }
      break;
    }

    case 'text-done': {
      const msg = session.messages.find((m) => m.id === event.messageId);
      if (!msg) break;
      const idx = msg.parts.findIndex((p) => p.type === 'text');
      if (idx >= 0) {
        (msg.parts[idx] as { text: string }).text = event.text;
      }
      break;
    }

    case 'tool-call-start': {
      const msg = session.messages.find((m) => m.id === event.messageId);
      if (!msg) break;
      msg.parts.push({
        type: 'tool-call',
        id: `part_${Date.now()}`,
        index: msg.parts.length,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: {},
      });
      break;
    }

    case 'tool-call-done': {
      const msg = session.messages.find((m) => m.id === event.messageId);
      if (!msg) break;
      const tc = msg.parts.find(
        (p) => p.type === 'tool-call' && (p as { toolCallId: string }).toolCallId === event.toolCallId,
      );
      if (tc && tc.type === 'tool-call') {
        (tc as { args: Record<string, unknown> }).args = event.args;
      }
      break;
    }

    case 'tool-result': {
      const msg = session.messages.find((m) => m.id === event.messageId);
      if (!msg) break;
      msg.parts.push({
        type: 'tool-result',
        id: `part_${Date.now()}`,
        index: msg.parts.length,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        result: event.result,
        isError: event.isError,
      });
      break;
    }

    case 'permission-request':
      session.pendingPermissions.push({
        id: event.requestId,
        workspaceId: event.workspaceId,
        sessionId: event.sessionId,
        toolName: event.toolName,
        domain: event.domain as PermissionRequest['domain'],
        input: null,
        description: event.description,
        riskLevel: event.riskLevel,
        timestamp: event.timestamp,
      });
      break;

    case 'permission-response':
      session.pendingPermissions = session.pendingPermissions.filter(
        (p) => p.id !== event.requestId,
      );
      break;

    case 'error':
      // Add error as a text part to the last message
      if (session.messages.length > 0) {
        const lastMsg = session.messages[session.messages.length - 1];
        lastMsg.parts.push({
          type: 'text',
          id: `part_${Date.now()}`,
          index: lastMsg.parts.length,
          text: `Error: ${event.message}`,
        });
      }
      break;
  }
}

export class EventStore {
  private state = new Map<string, WorkspaceState>();
  private listeners = new Set<() => void>();

  /** Called by SSE pipe for every incoming event -- no filtering */
  append(event: StreamEvent): void {
    const ws = this.getOrCreateWorkspace(event.workspaceId);
    const sess = this.getOrCreateSession(ws, event.sessionId);

    applyEvent(sess, event);
    this.notify();
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
