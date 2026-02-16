/**
 * Subagent reducers -- handle subagent-start, subagent-child-event, subagent-done.
 *
 * Manages a `childSessions` Map on SessionState keyed by parent toolCallId.
 * Each entry collects child parts (text, reasoning, tool-call, tool-result)
 * for live rendering in the SubagentCard.
 */

import type { SessionState } from '../event-store';
import type {
  SubagentStartEvent,
  SubagentChildEvent,
  SubagentDoneEvent,
} from '@coding-assistant/shared';

// ── Types ──────────────────────────────────────────────────────────────

export interface ChildSessionState {
  childSessionId: string;
  agentType: string;
  description: string;
  status: 'running' | 'completed' | 'error';
  resumed: boolean;
  durationMs?: number;
  parts: ChildPart[];
}

export type ChildPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: Record<string, unknown>; status: string }
  | { type: 'tool-result'; toolCallId: string; toolName: string; result: unknown; isError: boolean; durationMs?: number }
  | { type: 'error'; message: string };

// ── Reducers ───────────────────────────────────────────────────────────

export function applySubagentStart(session: SessionState, event: SubagentStartEvent): void {
  if (!session.childSessions) session.childSessions = new Map();

  session.childSessions.set(event.toolCallId, {
    childSessionId: event.childSessionId,
    agentType: event.agentType,
    description: event.description,
    status: 'running',
    resumed: event.resumed,
    parts: [],
  });

  // Shallow clone to trigger re-render
  session.childSessions = new Map(session.childSessions);
}

export function applySubagentChildEvent(session: SessionState, event: SubagentChildEvent): void {
  const child = session.childSessions?.get(event.toolCallId);
  if (!child) return;

  const ce = event.childEvent;

  switch (ce.type) {
    case 'text-delta': {
      const lastPart = child.parts[child.parts.length - 1];
      if (lastPart?.type === 'text') {
        child.parts = [
          ...child.parts.slice(0, -1),
          { ...lastPart, text: lastPart.text + (ce.delta as string) },
        ];
      } else {
        child.parts = [...child.parts, { type: 'text', text: ce.delta as string }];
      }
      break;
    }

    case 'reasoning-delta': {
      const lastPart = child.parts[child.parts.length - 1];
      if (lastPart?.type === 'reasoning') {
        child.parts = [
          ...child.parts.slice(0, -1),
          { ...lastPart, text: lastPart.text + (ce.delta as string) },
        ];
      } else {
        child.parts = [...child.parts, { type: 'reasoning', text: ce.delta as string }];
      }
      break;
    }

    case 'tool-call-done': {
      child.parts = [
        ...child.parts,
        {
          type: 'tool-call',
          toolCallId: ce.toolCallId as string,
          toolName: ce.toolName as string,
          args: (ce.args ?? {}) as Record<string, unknown>,
          status: 'running',
        },
      ];
      break;
    }

    case 'tool-result': {
      // Update the matching tool-call status
      const tcIdx = child.parts.findIndex(
        (p) => p.type === 'tool-call' && p.toolCallId === ce.toolCallId,
      );
      if (tcIdx !== -1) {
        const tc = child.parts[tcIdx] as Extract<ChildPart, { type: 'tool-call' }>;
        child.parts = [
          ...child.parts.slice(0, tcIdx),
          { ...tc, status: 'completed' },
          ...child.parts.slice(tcIdx + 1),
        ];
      }
      child.parts = [
        ...child.parts,
        {
          type: 'tool-result',
          toolCallId: ce.toolCallId as string,
          toolName: ce.toolName as string,
          result: ce.result,
          isError: !!(ce.isError),
          durationMs: ce.durationMs as number | undefined,
        },
      ];
      break;
    }

    case 'tool-error': {
      // Update matching tool-call status to error
      const tcIdx = child.parts.findIndex(
        (p) => p.type === 'tool-call' && p.toolCallId === ce.toolCallId,
      );
      if (tcIdx !== -1) {
        const tc = child.parts[tcIdx] as Extract<ChildPart, { type: 'tool-call' }>;
        child.parts = [
          ...child.parts.slice(0, tcIdx),
          { ...tc, status: 'error' },
          ...child.parts.slice(tcIdx + 1),
        ];
      }
      break;
    }

    case 'error': {
      // Surface child execution errors in the SubagentCard
      const errMsg = (ce.message as string) ?? (ce.code as string) ?? 'Unknown error';
      child.parts = [...child.parts, { type: 'error', message: errMsg }];
      break;
    }

    default:
      // Ignore other child event types (step-start, step-finish, etc.)
      break;
  }

  // Shallow clone Map to trigger re-render
  session.childSessions = new Map(session.childSessions!);
}

export function applySubagentDone(session: SessionState, event: SubagentDoneEvent): void {
  const child = session.childSessions?.get(event.toolCallId);
  if (!child) return;

  child.status = event.error ? 'error' : 'completed';
  child.durationMs = event.durationMs;

  session.childSessions = new Map(session.childSessions!);
}
