/**
 * PermissionRequestStore -- manages pending permission requests from tools.
 *
 * Previously this state lived as a module-level Map inside routes/permissions.ts.
 * Extracting it into a proper class enables:
 *   - Clean disposal (clear all timeouts on shutdown)
 *   - Testability (inject/mock the store)
 *   - Separation of concerns (routes are thin, state lives here)
 */

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface PendingEntry {
  resolve: (granted: boolean) => void;
  workspaceId: string;
  sessionId: string;
  timer: ReturnType<typeof setTimeout>;
}

export interface PendingRequest {
  requestId: string;
  workspaceId: string;
  sessionId: string;
}

export class PermissionRequestStore {
  private pending = new Map<string, PendingEntry>();

  /**
   * Register a new permission request.
   * Returns a promise that resolves when the user responds (or times out).
   */
  register(
    requestId: string,
    workspaceId: string,
    sessionId: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.has(requestId)) {
          this.pending.delete(requestId);
          resolve(false);
        }
      }, timeoutMs);

      this.pending.set(requestId, { resolve, workspaceId, sessionId, timer });
    });
  }

  /**
   * Respond to a pending permission request.
   * Returns the entry metadata if found, or null if expired/not found.
   */
  respond(requestId: string, granted: boolean): PendingRequest | null {
    const entry = this.pending.get(requestId);
    if (!entry) return null;

    clearTimeout(entry.timer);
    entry.resolve(granted);
    this.pending.delete(requestId);

    return {
      requestId,
      workspaceId: entry.workspaceId,
      sessionId: entry.sessionId,
    };
  }

  /**
   * List all currently pending requests.
   */
  listPending(): PendingRequest[] {
    return Array.from(this.pending.entries()).map(([id, entry]) => ({
      requestId: id,
      workspaceId: entry.workspaceId,
      sessionId: entry.sessionId,
    }));
  }

  /**
   * Clean up all pending requests (clears timeouts). Call on shutdown.
   */
  dispose(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve(false);
    }
    this.pending.clear();
  }
}
