import type { ModelInfo } from "@core/schema/provider"
import { bashTool } from "./builtin/bash"
import { editTool } from "./builtin/edit"
import { globTool } from "./builtin/glob"
import { grepTool } from "./builtin/grep"
import { listTool } from "./builtin/list"
import { readTool } from "./builtin/read"
import { taskTool } from "./builtin/task"
import { webFetchTool } from "./builtin/web-fetch"
import { webSearchTool } from "./builtin/web-search"
import { writeTool } from "./builtin/write"
import { filterTools } from "./filter"
import type { Tool } from "./shape"

/**
 * Central registry of all available tools.
 * Provides lookup, filtering by agent/model, and conversion to AI SDK format.
 */
class ToolRegistryImpl {
	private tools = new Map<string, Tool.Shape>()

	constructor() {
		const builtins: Tool.Shape[] = [
			bashTool,
			readTool,
			writeTool,
			editTool,
			globTool,
			grepTool,
			listTool,
			webFetchTool,
			webSearchTool,
			taskTool,
		]
		for (const tool of builtins) {
			this.tools.set(tool.id, tool)
		}
	}

	/** Get all registered tools. */
	all(): Tool.Shape[] {
		return [...this.tools.values()]
	}

	/** Get a single tool by ID. */
	get(id: string): Tool.Shape | undefined {
		return this.tools.get(id)
	}

	/** Resolve tools filtered for a specific agent + model combination. */
	resolve(
		agent: {
			name: string
			permission: {
				mode: string
				rules: Array<{ tool: string; allow: boolean }>
			}
		},
		modelInfo: ModelInfo,
	): Tool.Shape[] {
		return filterTools(this.all(), agent, modelInfo)
	}

	/** Convert resolved tools to AI SDK format for streamText. */
	toAITools(tools: Tool.Shape[], agent?: string): Record<string, any> {
		const result: Record<string, any> = {}
		for (const tool of tools) {
			const def = tool.init(agent)
			result[tool.id] = {
				description: def.description,
				parameters: def.parameters,
			}
		}
		return result
	}
}

export const ToolRegistry = new ToolRegistryImpl()
