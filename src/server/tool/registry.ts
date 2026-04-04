import type { PermissionRuleset } from "@core/schema/permission"
import type { ModelInfo } from "@core/schema/provider"
import { applyPatchTool } from "./builtin/apply-patch"
import { bashTool } from "./builtin/bash"
import { batchTool } from "./builtin/batch"
import { editTool } from "./builtin/edit"
import { globTool } from "./builtin/glob"
import { grepTool } from "./builtin/grep"
import { listTool } from "./builtin/list"
import { multiEditTool } from "./builtin/multiedit"
import { planEnterTool, planExitTool, planWriteTool } from "./builtin/plan"
import { questionTool } from "./builtin/question"
import { readTool } from "./builtin/read"
import { skillTool } from "./builtin/skill"
import { taskTool } from "./builtin/task"
import { todoReadTool, todoWriteTool } from "./builtin/todo"
import { webFetchTool } from "./builtin/web-fetch"
import { webSearchTool } from "./builtin/web-search"
import { writeTool } from "./builtin/write"
import { filterTools } from "./filter"
import type { Tool } from "./shape"

/**
 * Central registry of all available tools.
 * Provides lookup, filtering by permissions/model, and conversion to AI SDK format.
 */
class ToolRegistryImpl {
	private tools = new Map<string, Tool.Shape>()

	constructor() {
		const builtins: Tool.Shape[] = [
			bashTool,
			readTool,
			writeTool,
			editTool,
			multiEditTool,
			applyPatchTool,
			globTool,
			grepTool,
			listTool,
			webFetchTool,
			webSearchTool,
			taskTool,
			batchTool,
			questionTool,
			planWriteTool,
			planEnterTool,
			planExitTool,
			todoWriteTool,
			todoReadTool,
			skillTool,
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

	/** Resolve tools filtered for a specific ruleset + model combination. */
	resolve(ruleset: PermissionRuleset, modelInfo: ModelInfo): Tool.Shape[] {
		return filterTools(this.all(), ruleset, modelInfo)
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
