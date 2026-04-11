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
					<div className="flex items-center justify-between px-3.5 py-2 text-xs text-muted-foreground">
						<span>{done > 0 ? `${done}/${total} completed` : `${total} tasks`}</span>
					</div>
					<div className="max-h-48 overflow-y-auto border-t border-[var(--separator)] px-3.5 py-2 space-y-1">
						{todos.map((todo) => (
							<div key={todo.id} className="flex items-center gap-2.5 py-0.5 text-xs">
								<span className="shrink-0">
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
