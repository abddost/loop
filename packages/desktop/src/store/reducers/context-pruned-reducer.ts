/**
 * Context pruned reducer: context-pruned event -> ContextPrunedPart in the message.
 *
 * Follows the same immutable pattern as file-patch-reducer.
 */

import type { ContextPrunedEvent, MessagePart } from '@coding-assistant/shared';
import type { SessionState } from '../event-store';
import { findMessage, lastAssistantMessage, immutablePushPart } from './helpers';

export function applyContextPruned(session: SessionState, event: ContextPrunedEvent): void {
  const msg = findMessage(session, event.messageId) ?? lastAssistantMessage(session);
  if (!msg) return;

  immutablePushPart(session, msg, {
    type: 'context-pruned',
    id: `part_${Date.now()}_cp`,
    index: msg.parts.length,
    prunedCount: event.prunedCount,
    prunedTokens: event.prunedTokens,
    contextLimit: event.contextLimit,
    tokensBefore: event.tokensBefore,
    tokensAfter: event.tokensAfter,
  } as MessagePart);
}
