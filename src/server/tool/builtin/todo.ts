import { z } from "zod"
import { Workspace } from "../../workspace"
import type { Tool } from "../shape"

// ── Per-session todo storage ─────────────────────────────────

interface TodoItem {
	id: string
	content: string
	status: "todo" | "in-progress" | "done"
	priority: "high" | "medium" | "low"
}

/** Per-workspace map of sessionId → todo items. */
const todoStore = Workspace.state(
	() => new Map<string, Map<string, TodoItem>>(),
	(store) => store.clear(),
)

function getSessionTodos(sessionId: string): Map<string, TodoItem> {
	const store = todoStore()
	if (!store.has(sessionId)) {
		store.set(sessionId, new Map())
	}
	return store.get(sessionId)!
}

// ── todowrite ────────────────────────────────────────────────

export const todoWriteTool: Tool.Shape = {
	id: "todowrite",
	init() {
		return {
			description:
				"Create or update a todo list for tracking tasks. Each item has an id, content, status (todo/in-progress/done), and priority (high/medium/low). Pass the full desired state of the list — items not included will be removed.",
			parameters: z.object({
				todos: z.array(
					z.object({
						id: z.string().describe("Unique identifier for the todo item"),
						content: z.string().describe("Description of the task"),
						status: z.enum(["todo", "in-progress", "done"]).describe("Current status of the task"),
						priority: z.enum(["high", "medium", "low"]).describe("Priority level of the task"),
					}),
				),
			}),
			async execute(ctx, input) {
				await ctx.ask({
					permission: "todowrite",
					patterns: ["*"],
					always: ["*"],
					metadata: { reason: `Update todo list (${input.todos.length} items)` },
				})

				const todos = getSessionTodos(ctx.sessionId)
				todos.clear()

				for (const item of input.todos) {
					todos.set(item.id, item)
				}

				const summary = formatTodoList(todos)
				return {
					output: summary || "Todo list is now empty.",
					metadata: { count: todos.size },
				}
			},
		}
	},
}

// ── todoread ─────────────────────────────────────────────────

export const todoReadTool: Tool.Shape = {
	id: "todoread",
	init() {
		return {
			description:
				"Read the current todo list for this session. Returns all items with their status and priority.",
			parameters: z.object({}),
			async execute(ctx, _input) {
				await ctx.ask({
					permission: "todoread",
					patterns: ["*"],
					always: ["*"],
				})

				const todos = getSessionTodos(ctx.sessionId)

				if (todos.size === 0) {
					return { output: "No todos found. Use todowrite to create a todo list." }
				}

				return {
					output: formatTodoList(todos),
					metadata: { count: todos.size },
				}
			},
		}
	},
}

// ── Helpers ──────────────────────────────────────────────────

function formatTodoList(todos: Map<string, TodoItem>): string {
	if (todos.size === 0) return ""

	const statusIcon: Record<string, string> = {
		todo: "[ ]",
		"in-progress": "[~]",
		done: "[x]",
	}

	const priorityLabel: Record<string, string> = {
		high: "HIGH",
		medium: "MED",
		low: "LOW",
	}

	const lines: string[] = []
	for (const item of todos.values()) {
		lines.push(
			`${statusIcon[item.status]} (${priorityLabel[item.priority]}) ${item.id}: ${item.content}`,
		)
	}
	return lines.join("\n")
}
