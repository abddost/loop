/**
 * ID generation utilities.
 * Uses crypto.randomUUID() for guaranteed uniqueness.
 */

export function generateWorkspaceId(): string {
  return `ws_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function generateSessionId(): string {
  return `sess_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function generateMessageId(): string {
  return `msg_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function generatePartId(): string {
  return `part_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function generatePermissionId(): string {
  return `perm_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function generateRequestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}
