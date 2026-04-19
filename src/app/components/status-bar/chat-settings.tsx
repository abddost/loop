import { Brain, SettingsCog, Tasks, Tools } from "@openai/apps-sdk-ui/components/Icon"
import type { ComponentType } from "react"
import { useEffect, useRef, useState } from "react"
import { useConfigStore } from "../../stores/config-store"
import { useTaskPanelStore } from "../../stores/task-panel-store"
import { ToggleSwitch } from "../settings/shared"
import { cn } from "../ui/cn"

/**
 * Status-bar dropdown for per-chat display preferences. Currently hosts
 * the reasoning visibility toggle; designed so other "show / hide X
 * inside the message stream" switches can land here without growing
 * the status bar's horizontal footprint.
 */
export function ChatSettings({ className }: { className?: string }) {
	const [open, setOpen] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)
	const showReasoning = useConfigStore((s) => s.config.reasoning.showInChat)
	const showTools = useConfigStore((s) => s.config.tools.showInChat)
	const taskPanelOpen = useTaskPanelStore((s) => s.panelOpen)
	const toggleTaskPanel = useTaskPanelStore((s) => s.togglePanel)

	// Close on outside click. Using mousedown matches the rest of the
	// status-bar dropdowns (vcs-status, workspace-mode) so the same
	// click can both close this menu and focus a new control.
	useEffect(() => {
		if (!open) return
		const onPointerDown = (event: MouseEvent) => {
			if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
		}
		document.addEventListener("mousedown", onPointerDown)
		return () => document.removeEventListener("mousedown", onPointerDown)
	}, [open])

	const toggleReasoning = () => {
		useConfigStore.getState().update({ reasoning: { showInChat: !showReasoning } })
	}

	const toggleTools = () => {
		useConfigStore.getState().update({ tools: { showInChat: !showTools } })
	}

	return (
		<div className={cn("relative", className)} ref={containerRef}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className={cn(
					"el-surface-hover flex items-center gap-1.5 px-2 py-0.5 text-muted transition-colors",
					"hover:text-foreground",
					open && "bg-[var(--app-surface-hover)] text-foreground",
				)}
				aria-label="Chat display settings"
				aria-expanded={open}
				aria-haspopup="dialog"
			>
				<SettingsCog className="h-3.5 w-3.5" aria-hidden="true" />
			</button>

			{open && (
				<div
					className={cn(
						"absolute bottom-full right-0 z-50 mb-1 w-[240px] overflow-hidden rounded-xl",
						"el-dropdown shadow-[var(--shadow-dropdown)]",
						"animate-in fade-in slide-in-from-bottom-2 duration-150",
					)}
					aria-label="Chat display settings"
				>
					<div className="p-1">
						<SettingRow
							icon={Brain}
							label="Reasoning"
							description="Show the model's intermediate thinking"
							checked={showReasoning}
							onChange={toggleReasoning}
						/>
						<SettingRow
							icon={Tools}
							label="Tools"
							description="Show tool calls and work log after streaming"
							checked={showTools}
							onChange={toggleTools}
						/>
						<SettingRow
							icon={Tasks}
							label="Tasks and Agents"
							description="Right-side panel for background subagent progress"
							checked={taskPanelOpen}
							onChange={toggleTaskPanel}
						/>
					</div>
				</div>
			)}
		</div>
	)
}

/**
 * One row inside the settings popover — icon + (label + description) +
 * switch. Pulled out so future settings (e.g. "Show empty tool
 * outputs", "Auto-collapse reads") slot in without re-implementing
 * the layout.
 */
function SettingRow({
	icon: Icon,
	label,
	description,
	checked,
	onChange,
}: {
	icon: ComponentType<{ className?: string }>
	label: string
	description?: string
	checked: boolean
	onChange: () => void
}) {
	return (
		<button
			type="button"
			onClick={onChange}
			className="el-surface-hover flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left"
		>
			<Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
			<div className="min-w-0 flex-1">
				<div className="text-xs font-medium text-foreground">{label}</div>
				{description && (
					<div className="text-[10px] leading-tight text-muted-foreground/70">{description}</div>
				)}
			</div>
			<ToggleSwitch checked={checked} onChange={onChange} />
		</button>
	)
}
