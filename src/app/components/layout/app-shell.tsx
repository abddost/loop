import { type ReactNode, useCallback, useEffect, useRef, useState } from "react"
import { useUIStore } from "../../stores/ui-store"
import { cn } from "../ui/cn"

export interface AppShellProps {
	sidebar: ReactNode
	children: ReactNode
	className?: string
}

const MIN_WIDTH = 200
const MAX_WIDTH = 500

/**
 * Main application layout: resizable sidebar (left) + content area (right).
 * Sidebar animates open/closed smoothly via CSS transition on width.
 * A subtle glow on the sidebar's right edge simulates glass bleed from content.
 */
export function AppShell({ sidebar, children, className }: AppShellProps) {
	const sidebarOpen = useUIStore((s) => s.sidebarOpen)
	const sidebarWidth = useUIStore((s) => s.sidebarWidth)
	const isFreshSession = useUIStore((s) => s.activeSessionId === null)
	const dragging = useRef(false)
	const [isDragging, setIsDragging] = useState(false)

	const handleMouseDown = useCallback((e: React.MouseEvent) => {
		e.preventDefault()
		dragging.current = true
		setIsDragging(true)
		document.body.style.cursor = "col-resize"
		document.body.style.userSelect = "none"
	}, [])

	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			if (!dragging.current) return
			const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX))
			useUIStore.getState().setSidebarWidth(clamped)
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
	}, [])

	const resolvedWidth = sidebarOpen ? sidebarWidth : 0
	const transition = isDragging ? "none" : "width 200ms ease-in-out"

	return (
		<div className={cn("flex h-screen w-screen overflow-hidden bg-background", className)}>
			<aside
				className="relative flex h-full shrink-0 flex-col overflow-hidden border-r border-white/[0.06] bg-surface"
				style={{ width: resolvedWidth, transition }}
			>
				<div className="flex h-full flex-col" style={{ width: sidebarWidth }}>
					{sidebar}
				</div>
				{/* Green glow bleed — only on fresh session page */}
				{isFreshSession && (
					<div
						className="pointer-events-none absolute top-0 right-0 h-full w-24 opacity-30"
						style={{
							background: "linear-gradient(to left, rgba(52,211,153,0.15), transparent)",
						}}
						aria-hidden="true"
					/>
				)}
			</aside>
			{sidebarOpen && (
				<div
					className="h-full w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-accent/40"
					onMouseDown={handleMouseDown}
				/>
			)}
			<main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
		</div>
	)
}
