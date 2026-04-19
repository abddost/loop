import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { useFilePanelStore } from "../../stores/file-panel-store"
import { useTaskPanelStore } from "../../stores/task-panel-store"
import { useUIStore } from "../../stores/ui-store"
import { cn } from "../ui/cn"

export interface AppShellProps {
	sidebar: ReactNode
	children: ReactNode
	rightPanel?: ReactNode
	/** Secondary right panel (e.g. background subagent progress) rendered
	 *  to the right of `rightPanel`. Toggled via `useTaskPanelStore`. */
	taskPanel?: ReactNode
	className?: string
}

const MIN_SIDEBAR_WIDTH = 200
const MAX_SIDEBAR_WIDTH = 500
const MIN_CONTENT_WIDTH = 400

/**
 * Main application layout: resizable sidebar (left) + content area (center) + optional right panel.
 * Sidebar and right panel animate open/closed smoothly via CSS transition on width.
 */
export function AppShell({ sidebar, children, rightPanel, taskPanel, className }: AppShellProps) {
	const sidebarOpen = useUIStore((s) => s.sidebarOpen)
	const sidebarWidth = useUIStore((s) => s.sidebarWidth)

	const filePanelOpen = useFilePanelStore((s) => s.panelOpen)
	const filePanelWidth = useFilePanelStore((s) => s.panelWidth)

	const taskPanelOpen = useTaskPanelStore((s) => s.panelOpen)
	const taskPanelWidth = useTaskPanelStore((s) => s.panelWidth)

	// ── Left sidebar resize ──
	const leftDragging = useRef(false)
	const [isLeftDragging, setIsLeftDragging] = useState(false)

	const handleLeftMouseDown = useCallback((e: React.MouseEvent) => {
		e.preventDefault()
		leftDragging.current = true
		setIsLeftDragging(true)
		document.body.style.cursor = "col-resize"
		document.body.style.userSelect = "none"
	}, [])

	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			if (!leftDragging.current) return
			const clamped = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, e.clientX))
			useUIStore.getState().setSidebarWidth(clamped)
		}
		const onMouseUp = () => {
			if (!leftDragging.current) return
			leftDragging.current = false
			setIsLeftDragging(false)
			document.body.style.cursor = ""
			document.body.style.userSelect = ""
		}
		document.addEventListener("mousemove", onMouseMove)
		document.addEventListener("mouseup", onMouseUp)
		return () => {
			document.removeEventListener("mousemove", onMouseMove)
			document.removeEventListener("mouseup", onMouseUp)
		}
	}, [])

	// ── Right panel resize ──
	const rightDragging = useRef(false)
	const [isRightDragging, setIsRightDragging] = useState(false)

	const handleRightMouseDown = useCallback((e: React.MouseEvent) => {
		e.preventDefault()
		rightDragging.current = true
		setIsRightDragging(true)
		document.body.style.cursor = "col-resize"
		document.body.style.userSelect = "none"
	}, [])

	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			if (!rightDragging.current) return
			const width = window.innerWidth - e.clientX
			// Enforce minimum content width
			const resolvedSidebar = sidebarOpen ? sidebarWidth : 0
			const maxRight = window.innerWidth - resolvedSidebar - MIN_CONTENT_WIDTH
			const clamped = Math.min(maxRight, width)
			useFilePanelStore.getState().setPanelWidth(clamped)
		}
		const onMouseUp = () => {
			if (!rightDragging.current) return
			rightDragging.current = false
			setIsRightDragging(false)
			document.body.style.cursor = ""
			document.body.style.userSelect = ""
		}
		document.addEventListener("mousemove", onMouseMove)
		document.addEventListener("mouseup", onMouseUp)
		return () => {
			document.removeEventListener("mousemove", onMouseMove)
			document.removeEventListener("mouseup", onMouseUp)
		}
	}, [sidebarOpen, sidebarWidth])

	const resolvedSidebarWidth = sidebarOpen ? sidebarWidth : 0
	const resolvedPanelWidth = filePanelOpen ? filePanelWidth : 0
	const resolvedTaskPanelWidth = taskPanelOpen ? taskPanelWidth : 0
	const isDragging = isLeftDragging || isRightDragging
	const transition = isDragging ? "none" : "width 200ms ease-in-out"

	return (
		<div data-shell className={cn("flex h-screen w-screen overflow-hidden bg-surface", className)}>
			{/* Left sidebar */}
			<aside
				data-sidebar
				className="relative flex h-full shrink-0 flex-col overflow-hidden bg-surface"
				style={{ width: resolvedSidebarWidth, transition }}
			>
				<div className="flex h-full flex-col" style={{ width: sidebarWidth }}>
					{sidebar}
				</div>
			</aside>

			{sidebarOpen && (
				<div
					className="relative z-10 h-full w-px shrink-0 cursor-col-resize shadow-[var(--shadow-inset)] transition-colors hover:bg-accent/40 before:absolute before:inset-y-0 before:-left-1.5 before:-right-1.5 before:cursor-col-resize before:content-['']"
					onMouseDown={handleLeftMouseDown}
				/>
			)}

			{/* Center content */}
			<main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background">
				{children}
			</main>

			{/* Right panel resize handle */}
			{rightPanel && filePanelOpen && (
				<div
					className="h-full w-1 shrink-0 cursor-col-resize bg-transparent shadow-[var(--shadow-inset)] transition-colors hover:bg-accent/40"
					onMouseDown={handleRightMouseDown}
				/>
			)}

			{/* Right panel */}
			{rightPanel && (
				<aside
					data-file-panel
					className="relative flex h-full shrink-0 flex-col overflow-hidden"
					style={{ width: resolvedPanelWidth, transition }}
				>
					<div className="flex h-full flex-col" style={{ width: filePanelWidth }}>
						{rightPanel}
					</div>
				</aside>
			)}

			{/* Secondary right panel (tasks / subagents) */}
			{taskPanel && (
				<aside
					data-task-panel
					className="relative flex h-full shrink-0 flex-col overflow-hidden border-l border-border/50"
					style={{ width: resolvedTaskPanelWidth, transition }}
				>
					<div className="flex h-full flex-col" style={{ width: taskPanelWidth }}>
						{taskPanel}
					</div>
				</aside>
			)}
		</div>
	)
}
