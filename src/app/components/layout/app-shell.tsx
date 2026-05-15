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
			// File panel is anchored to `right: taskPanelWidth`, so its width
			// is the distance from the cursor to the task panel's left edge.
			const taskPanelW = useTaskPanelStore.getState().panelOpen
				? useTaskPanelStore.getState().panelWidth
				: 0
			const width = window.innerWidth - taskPanelW - e.clientX
			// Enforce minimum content width
			const resolvedSidebar = sidebarOpen ? sidebarWidth : 0
			const maxRight = window.innerWidth - resolvedSidebar - taskPanelW - MIN_CONTENT_WIDTH
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
	// sidebar — the chat content sits underneath. Because the panel is an
	// overlay (absolute), main keeps its width; the panel just covers more
	// of it as the width animates up.
	const resolvedPanelWidth: number | string = filePanelOpen
		? filePanelExpanded
			? `calc(100vw - ${resolvedSidebarWidth}px - ${resolvedTaskPanelWidth}px)`
			: filePanelWidth
		: 0
	const isDragging = isLeftDragging || isRightDragging
	// Match the terminal panel's animation feel: a single property, simple
	// ease, ~280ms. Both `width` and `right` are listed because the panel
	// tracks the task panel's edge when the task panel opens/closes
	// alongside it.
	const transition = isDragging
		? "none"
		: "width 280ms ease, right 280ms ease, box-shadow 280ms ease"
	const sidebarTransition = isDragging ? "none" : "width 280ms ease"

	return (
		<div
			data-shell
			className={cn("relative flex h-screen w-screen overflow-hidden bg-surface", className)}
		>
			{/* Left sidebar */}
			<aside
				data-sidebar
				className="relative flex h-full shrink-0 flex-col overflow-hidden bg-surface"
				style={{ width: resolvedSidebarWidth, transition: sidebarTransition }}
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

			{/* Center content — keeps its full width regardless of file panel
			    state. The file panel is an overlay (absolute) so opening it
			    no longer reflows / squeezes main. The task panel still
			    pushes from the right because it's a true layout sibling. */}
			<main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background">
				{children}
			</main>

			{/* Secondary right panel (tasks / subagents) — true sibling,
			    sits to the right of main and pushes it leftward. */}
			{taskPanel && (
				<aside
					data-task-panel
					className="relative flex h-full shrink-0 flex-col overflow-hidden border-l border-border/50"
					style={{ width: resolvedTaskPanelWidth, transition: sidebarTransition }}
				>
					<div className="flex h-full flex-col" style={{ width: taskPanelWidth }}>
						{taskPanel}
					</div>
				</aside>
			)}

			{/* File panel — overlay, NOT in the flex flow.
			    - `absolute` anchored to `right: taskPanelWidth` so it sits
			      flush against the task panel (or the viewport edge when
			      the task panel is closed) and covers main from the right.
			    - `width` animates open/closed; `right` animates with the
			      task panel so the two edges stay glued.
			    - `[contain:layout_paint_style]` isolates the panel's
			      reflow/repaint to itself.
			    - `min-width: 0` keeps flex defaults from flooring the width
			      and is harmless here (preserved for the close-to-zero
			      state when the panel is shut). */}
			{rightPanel && (
				<aside
					data-file-panel
					className="absolute top-0 bottom-0 z-20 flex flex-col overflow-hidden bg-background [contain:layout_paint_style]"
					style={{
						right: resolvedTaskPanelWidth,
						width: resolvedPanelWidth,
						transition,
						minWidth: 0,
						boxShadow: filePanelOpen
							? "rgba(0, 0, 0, 0.18) -8px 0 24px -4px, rgba(0, 0, 0, 0.08) -2px 0 6px -1px"
							: "none",
					}}
				>
					{/* Resize handle on the panel's left edge. Hidden in
					    expanded mode — the panel snaps to a derived
					    fullscreen width and the saved panelWidth is
					    preserved for the next collapse. */}
					{filePanelOpen && !filePanelExpanded && (
						<div
							className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize bg-transparent transition-colors hover:bg-accent/40"
							onMouseDown={handleRightMouseDown}
						/>
					)}
					{rightPanel}
				</aside>
			)}
		</div>
	)
}
