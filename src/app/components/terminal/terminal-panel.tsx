import { Plus, X } from "@openai/apps-sdk-ui/components/Icon"
import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react"
import {
	selectActiveTerminalId,
	selectTerminals,
	useTerminalStore,
} from "../../stores/terminal-store"
import { cn } from "../ui/cn"
import { TerminalInstance } from "./terminal-instance"

/**
 * Bottom terminal panel with tabs, resizable height, and smooth toggle animation.
 * Workspace-scoped: persists across session switches within the same workspace.
 */
export function TerminalPanel() {
	const panelOpen = useTerminalStore((s) => s.panelOpen)
	const panelHeight = useTerminalStore((s) => s.panelHeight)
	const terminals = useTerminalStore(selectTerminals)
	const activeTerminalId = useTerminalStore(selectActiveTerminalId)
	const createTerminal = useTerminalStore((s) => s.createTerminal)
	const closeTerminal = useTerminalStore((s) => s.closeTerminal)
	const setActiveTerminal = useTerminalStore((s) => s.setActiveTerminal)
	const togglePanel = useTerminalStore((s) => s.togglePanel)
	const setPanelHeight = useTerminalStore((s) => s.setPanelHeight)

	const dragging = useRef(false)
	const startY = useRef(0)
	const startHeight = useRef(0)
	const [isDragging, setIsDragging] = useState(false)

	const handleDragStart = useCallback(
		(e: MouseEvent) => {
			e.preventDefault()
			dragging.current = true
			startY.current = e.clientY
			startHeight.current = panelHeight
			setIsDragging(true)
			document.body.style.cursor = "row-resize"
			document.body.style.userSelect = "none"
		},
		[panelHeight],
	)

	useEffect(() => {
		const onMouseMove = (e: globalThis.MouseEvent) => {
			if (!dragging.current) return
			const delta = startY.current - e.clientY
			setPanelHeight(startHeight.current + delta)
		}
		const onMouseUp = () => {
			if (!dragging.current) return
			dragging.current = false
			setIsDragging(false)
			document.body.style.cursor = ""
			document.body.style.userSelect = ""
		}
		document.addEventListener("mousemove", onMouseMove)
		document.addEventListener("mouseup", onMouseUp)
		return () => {
			document.removeEventListener("mousemove", onMouseMove)
			document.removeEventListener("mouseup", onMouseUp)
		}
	}, [setPanelHeight])

	const handleCloseTab = useCallback(
		(e: MouseEvent, id: string) => {
			e.stopPropagation()
			closeTerminal(id)
		},
		[closeTerminal],
	)

	const transition = isDragging ? "none" : "height 200ms ease"

	return (
		<div
			className={cn(
				"shrink-0 overflow-hidden bg-terminal-bg",
				panelOpen && "shadow-[inset_0_1px_0_0_var(--separator)]",
			)}
			style={{
				height: panelOpen ? panelHeight : 0,
				transition,
			}}
		>
			{/* Resize handle */}
			<div
				className="group flex h-1.5 cursor-row-resize items-center justify-center hover:bg-accent/20"
				onMouseDown={handleDragStart}
			>
				<div className="h-0.5 w-8 rounded-full bg-border transition-colors group-hover:bg-accent/60" />
			</div>

			{/* Tab bar */}
			<div className="flex h-8 items-center gap-0 px-1 shadow-[var(--shadow-inset)]">
				<div className="flex min-w-0 flex-1 items-center gap-0 overflow-x-auto">
					{terminals.map((t) => {
						const isActive = t.id === activeTerminalId
						return (
							<div
								key={t.id}
								role="tab"
								tabIndex={0}
								onClick={() => setActiveTerminal(t.id)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") setActiveTerminal(t.id)
								}}
								className={cn(
									"group/tab relative el-tab flex h-7 shrink-0 cursor-pointer items-center gap-1.5 px-2.5 text-xs",
									isActive
										? "bg-background/60 text-foreground"
										: "text-muted-foreground hover:text-foreground",
								)}
							>
								<span className="max-w-[120px] truncate">{t.title}</span>
								<button
									type="button"
									onClick={(e) => handleCloseTab(e, t.id)}
									className="el-surface-hover flex h-4 w-4 items-center justify-center rounded opacity-0 transition-opacity group-hover/tab:opacity-100"
									aria-label={`Close ${t.title}`}
								>
									<X className="h-2 w-2" aria-hidden="true" />
								</button>
								{isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />}
							</div>
						)
					})}
				</div>
				{/* Add terminal button */}
				<button
					type="button"
					onClick={() => createTerminal()}
					className="el-surface-hover flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
					aria-label="New terminal"
				>
					<Plus className="h-3.5 w-3.5" aria-hidden="true" />
				</button>

				<div className="mx-1 h-4 w-px shadow-[var(--shadow-inset)]" />

				{/* Close panel button */}
				<button
					type="button"
					onClick={togglePanel}
					className="el-surface-hover flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
					aria-label="Close panel"
				>
					<X className="h-3.5 w-3.5" aria-hidden="true" />
				</button>
			</div>

			{/* Terminal content — absolute stacking avoids remount/flashing on tab switch */}
			<div className="relative" style={{ height: "calc(100% - 42px)" }}>
				{terminals.map((t) => {
					const isVisible = t.id === activeTerminalId
					return (
						<div
							key={t.id}
							className="absolute inset-0"
							style={{
								visibility: isVisible ? "visible" : "hidden",
								zIndex: isVisible ? 1 : 0,
							}}
						>
							<TerminalInstance terminalId={t.id} visible={isVisible} />
						</div>
					)
				})}
				{terminals.length === 0 && (
					<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
						No active terminals
					</div>
				)}
			</div>
		</div>
	)
}
