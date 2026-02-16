/**
 * File-patch reducer: file-patch event -> FilePatchPart in the message.
 *
 * Follows the same immutable pattern as step-start/step-finish reducers.
 */

import type { FilePatchEvent, MessagePart } from '@coding-assistant/shared';
import type { SessionState } from '../event-store';
import { findMessage, lastAssistantMessage, immutablePushPart } from './helpers';

export function applyFilePatch(session: SessionState, event: FilePatchEvent): void {
  const msg = findMessage(session, event.messageId) ?? lastAssistantMessage(session);
  if (!msg) return;

  // Skip empty patches (no files changed)
  if (event.files.length === 0) return;

  immutablePushPart(session, msg, {
    type: 'file-patch',
    id: `part_${Date.now()}_fp`,
    index: msg.parts.length,
    stepNumber: event.stepNumber,
    files: event.files,
  } as MessagePart);
}
