/**
 * pickDirectory -- opens a native folder picker via Tauri dialog plugin.
 *
 * Falls back to window.prompt when running outside Tauri (e.g. plain Vite dev).
 */

/**
 * Check whether we're running inside a Tauri webview.
 */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Open a native directory picker and return the selected path, or null if cancelled.
 */
export async function pickDirectory(): Promise<string | null> {
  if (isTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select project folder',
      });

      // `open` returns string | string[] | null depending on options
      if (typeof selected === 'string') return selected;
      return null;
    } catch (err) {
      console.warn('[pickDirectory] Tauri dialog failed, falling back to prompt:', err);
    }
  }

  // Fallback for browser-only dev mode
  return window.prompt('Enter workspace path:');
}
