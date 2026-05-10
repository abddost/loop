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
	const filePanelExpanded = useFilePanelStore((s) => s.panelExpanded)

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
	const resolvedTaskPanelWidth = taskPanelOpen ? taskPanelWidth : 0
	// In expanded mode the file panel takes everything to the right of the
	// sidebar — the chat content is collapsed to width 0 underneath. Width
	// transitions on the panel + main animate the slide-left.
	const resolvedPanelWidth: number | string = filePanelOpen
		? filePanelExpanded
			? `calc(100vw - ${resolvedSidebarWidth}px - ${resolvedTaskPanelWidth}px)`
			: filePanelWidth
		: 0
	const isDragging = isLeftDragging || isRightDragging
	// Match the terminal panel's animation feel: a single property, simple
	// ease, ~280ms. The terminal panel reads as instant-but-smooth and the
	// file panel should match.
	const transition = isDragging ? "none" : "width 280ms ease"

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

			{/* Center content — flex-1 always, so its width is implicitly
			    derived from "leftover space after sidebar + file panel +
			    task panel". When the file panel expands, its width animates
			    up; flex re-derives main's width down each frame. No inline
			    width override on main is needed (and animating both width
			    *and* flex-shorthand at once produced a brief gap mid-frame). */}
			<main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background">
				{children}
			</main>

			{/* Right panel resize handle — disabled in expanded mode (the
			    panel snaps to a derived fullscreen width and the saved
			    panelWidth is preserved for the next collapse). */}
			{rightPanel && filePanelOpen && !filePanelExpanded && (
				<div
					className="h-full w-1 shrink-0 cursor-col-resize bg-transparent shadow-[var(--shadow-inset)] transition-colors hover:bg-accent/40"
					onMouseDown={handleRightMouseDown}
				/>
			)}

			{/* Right panel — modeled on terminal-panel.tsx:
			    - One container; the animated width is the only thing that
			      changes. No absolute-positioned inner with a different
			      width that mid-animation can desync from the outer.
			    - `[contain:layout_paint_style]` isolates the panel's
			      reflow/repaint to itself, mirroring the terminal panel.
			    - `min-width: 0` is essential — without it, flex's default
			      `min-width: auto` floors the aside at its content's
			      min-content width, breaking the close-to-zero state. */}
			{rightPanel && (
				<aside
					data-file-panel
					className="flex h-full shrink-0 flex-col overflow-hidden [contain:layout_paint_style]"
					style={{ width: resolvedPanelWidth, transition, minWidth: 0 }}
				>
					{rightPanel}
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
