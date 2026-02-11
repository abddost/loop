/**
 * ToolRegistry -- Stateless singleton that holds definitions.
 * Context is injected at call time, not stored.
 */

import type { ToolCategory } from '@coding-assistant/shared';
import type { ToolDefinition, ToolExecCtx } from './types.js';

export type AISDKToolSet = Record<string, {
  description: string;
  parameters: unknown;
  execute: (input: unknown) => Promise<unknown>;
}>;

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
   */
  toAISDKTools(
    ctx: ToolExecCtx,
    filter?: { categories?: ToolCategory[] },
  ): AISDKToolSet {
    const result: AISDKToolSet = {};

    for (const [name, def] of this.definitions) {
      if (filter?.categories && !filter.categories.includes(def.category)) {
        continue;
      }

      result[name] = {
        description: def.description,
        parameters: def.inputSchema,
        execute: async (input) => {
          const output = await def.execute(input, ctx);
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
