/**
 * Tool lifecycle management -- wraps execution with
 * validation, timing, error handling.
 */

import type { ToolDefinition, ToolExecCtx, ToolResult } from './types.js';
import { validateToolInput } from './validator.js';

export interface ExecutionMetrics {
  toolName: string;
  startedAt: number;
  finishedAt: number;
  duration: number;
  success: boolean;
  error?: string;
}

/**
 * Execute a tool with full lifecycle management.
 */
export async function executeToolWithLifecycle<TInput, TOutput>(
  def: ToolDefinition<TInput, TOutput>,
  rawInput: unknown,
  ctx: ToolExecCtx,
): Promise<{ result: ToolResult<TOutput>; metrics: ExecutionMetrics }> {
  const startedAt = Date.now();

  // Validate input
  const validation = validateToolInput(def.inputSchema, rawInput);
  if (!validation.success) {
    throw new Error(
      `Invalid input for tool ${def.name}: ${validation.errors?.join(', ')}`,
    );
  }

  try {
    // Check abort signal
    ctx.abort.throwIfAborted();

    // Execute
    const result = await def.execute(validation.data!, ctx);

    const finishedAt = Date.now();
    return {
      result,
      metrics: {
        toolName: def.name,
        startedAt,
        finishedAt,
        duration: finishedAt - startedAt,
        success: true,
      },
    };
  } catch (error) {
    const finishedAt = Date.now();
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return {
      result: {
        result: { error: errorMessage } as unknown as TOutput,
        metadata: { error: true },
      },
      metrics: {
        toolName: def.name,
        startedAt,
        finishedAt,
        duration: finishedAt - startedAt,
        success: false,
        error: errorMessage,
      },
    };
  }
}
