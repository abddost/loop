/**
 * Unwrap AI SDK envelope format from tool results.
 *
 * The AI SDK wraps tool results in `{ type: "json"|"text", value: ... }`
 * when accessed via `result.response.messages` (persistence path).
 * During streaming, results arrive as raw values (no envelope).
 *
 * This normalizes both formats so downstream code always sees the raw value.
 */
export function unwrapToolResult(result: unknown): unknown {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const r = result as Record<string, unknown>;
    if (
      ('type' in r) && ('value' in r) &&
      (r.type === 'json' || r.type === 'text' || r.type === 'error-text')
    ) {
      return r.value;
    }
  }
  return result;
}
