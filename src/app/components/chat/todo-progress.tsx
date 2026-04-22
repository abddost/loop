import { Tasks } from "@openai/apps-sdk-ui/components/Icon"
import { cn } from "../ui/cn"
import { CheckboxChecked, CheckboxEmpty, CheckboxPartial } from "./tool-call"

export interface TodoItem {
	id: string
	content: string
	status: string
	priority: string
}

interface TodoPanelProps {
	todos: TodoItem[]
	open: boolean
	className?: string
}

/**
 * Todo list panel shown above the input bar.
 * Controlled by the "Tasks" toggle in the status bar.
 */
export function TodoPanel({ todos, open, className }: TodoPanelProps) {
	if (!open || todos.length === 0) return null

	const done = todos.filter((t) => t.status === "done").length
	const total = todos.length

	return (
		<div className={className}>
			<div className="mx-auto w-full max-w-[52rem] px-12">
				<div className="rounded-t-xl bg-surface/60 backdrop-blur-sm shadow-[var(--shadow-card)]">
					{/* Header */}
					<div className="flex items-center gap-2 px-4 py-2.5">
						<Tasks className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
						<span className="text-xs font-medium text-foreground">Tasks</span>
						<span className="ml-auto text-xs text-muted-foreground">
							{done > 0 ? `${done}/${total} completed` : `${total} tasks`}
						</span>
					</div>
					{/* Items */}
					<div className="max-h-48 overflow-y-auto border-t border-[var(--separator)] px-4 py-2 space-y-0.5">
						{todos.map((todo) => (
							<div key={todo.id} className="flex items-center gap-3 py-1 text-xs">
								<span className="shrink-0 scale-[1.15]">
									{todo.status === "done" ? (
										<CheckboxChecked />
									) : todo.status === "in-progress" ? (
										<CheckboxPartial />
									) : (
										<CheckboxEmpty />
									)}
								</span>
								<span
									className={cn(
										"min-w-0 flex-1",
										todo.status === "done" && "line-through text-muted-foreground/60",
									)}
								>
									{todo.content}
								</span>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	)
}
