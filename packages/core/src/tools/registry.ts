/**
 * ToolRegistry -- Stateless singleton that holds definitions.
 * Context is injected at call time, not stored.
 */

import type { ToolCategory } from '@coding-assistant/shared';
import type { ToolDefinition, ToolExecCtx } from './types.js';

/** AI SDK v6 tool set -- uses 'inputSchema' (renamed from 'parameters' in v4). */
export type AISDKToolSet = Record<string, {
  description: string;
  inputSchema: unknown;
  execute: (input: unknown, options?: { toolCallId?: string }) => Promise<unknown>;
}>;

/** Optional hooks for observability around tool execution. */
export interface ToolExecutionHooks {
  beforeExecute?: (toolName: string, input: unknown) => void | Promise<void>;
  afterExecute?: (toolName: string, input: unknown, output: unknown, durationMs: number) => void | Promise<void>;
}

export class ToolRegistry {
  private definitions = new Map<string, ToolDefinition>();

  /**
   * Register a tool definition.
   */
  register(def: ToolDefinition): void {
    if (this.definitions.has(def.name)) {
      throw new Error(`Tool already registered: ${def.name}`);
    }
    this.definitions.set(def.name, def);
  }

  /**
   * Get a tool definition by name.
   */
  get(name: string): ToolDefinition | undefined {
    return this.definitions.get(name);
  }

  /**
   * List all registered tools.
   */
  list(): ToolDefinition[] {
    return Array.from(this.definitions.values());
  }

  /**
   * List tools by category.
   */
  listByCategory(category: ToolCategory): ToolDefinition[] {
    return this.list().filter((def) => def.category === category);
  }

  /**
   * Build AI SDK ToolSet with context closures.
   * Each tool gets the execution context injected at call time.
   * Optional hooks allow observability (logging, metrics) around execution.
   */
  toAISDKTools(
    ctx: ToolExecCtx,
    filter?: { categories?: ToolCategory[] },
    hooks?: ToolExecutionHooks,
  ): AISDKToolSet {
    const result: AISDKToolSet = {};

    for (const [name, def] of this.definitions) {
      if (filter?.categories && !filter.categories.includes(def.category)) {
        continue;
      }

      result[name] = {
        description: def.description,
        inputSchema: def.inputSchema,
        execute: async (input: unknown, options?: { toolCallId?: string }) => {
          await hooks?.beforeExecute?.(name, input);
          const start = Date.now();
          const extendedCtx = options?.toolCallId
            ? { ...ctx, toolCallId: options.toolCallId }
            : ctx;
          const output = await def.execute(input, extendedCtx);
          const durationMs = Date.now() - start;
          await hooks?.afterExecute?.(name, input, output.result, durationMs);
          return output.result;
        },
      };
    }

    return result;
  }

  /**
   * Number of registered tools.
   */
  get size(): number {
    return this.definitions.size;
  }
}

/** Singleton registry */
export const toolRegistry = new ToolRegistry();
