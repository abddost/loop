/**
 * Human-readable permission descriptions and risk level classification.
 *
 * Used when emitting permission-request events so the UI can display
 * meaningful context about what the tool wants to do.
 */

/**
 * Build a human-readable description of what a tool call wants to do.
 */
export function buildPermissionDescription(toolName: string, input: unknown): string {
  const inp = input as Record<string, unknown>;
  switch (toolName) {
    case 'bash':
      return `Execute: ${((inp.command as string) ?? '').slice(0, 100)}`;
    case 'file-write':
      return `Write to: ${inp.path ?? 'unknown'}`;
    case 'file-edit':
      return `Edit: ${inp.path ?? 'unknown'}`;
    case 'file-patch':
      return `Patch: ${inp.path ?? 'unknown'}`;
    case 'file-read':
      return `Read: ${inp.path ?? 'unknown'}`;
    case 'web-fetch':
      return `Fetch URL: ${inp.url ?? 'unknown'}`;
    case 'web-search':
      return `Web search: ${inp.query ?? 'unknown'}`;
    case 'glob':
      return `Search files: ${inp.pattern ?? 'unknown'}`;
    case 'grep':
      return `Search content: ${inp.pattern ?? 'unknown'}`;
    default:
      return `Use tool: ${toolName}`;
  }
}

/**
 * Classify the risk level of a tool call.
 */
export function getRiskLevel(toolName: string): 'safe' | 'moderate' | 'dangerous' {
  if (toolName === 'bash') return 'dangerous';
  if (['file-write', 'file-edit', 'file-patch'].includes(toolName)) return 'moderate';
  if (['web-fetch', 'web-search'].includes(toolName)) return 'moderate';
  return 'safe';
}
