import { Plus, Sidebar, Terminal, Trash, X } from "@openai/apps-sdk-ui/components/Icon"
import {
	type CSSProperties,
	type MouseEvent,
	type TransitionEvent as ReactTransitionEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { MAX_TERMINALS_PER_GROUP } from "../../stores/terminal-groups"
import {
	selectActiveGroupId,
	selectActiveTerminalId,
	selectIsActiveGroupFull,
	selectTerminalGroups,
	selectTerminals,
	selectVisibleTerminalIds,
	useTerminalStore,
} from "../../stores/terminal-store"
import { cn } from "../ui/cn"
import { TerminalInstance } from "./terminal-instance"

/**
 * Bottom terminal panel with split-group layout.
 * - Main viewport shows the active group as a CSS-grid split
 * - Sidebar tree (when >1 terminal) shows all groups with per-terminal close
 * - Every TerminalInstance stays mounted across group switches via absolute
 *   positioning, so PTY connections persist when toggling between groups
 */
export function TerminalPanel() {
	const panelOpen = useTerminalStore((s) => s.panelOpen)
	const panelHeight = useTerminalStore((s) => s.panelHeight)
	const terminals = useTerminalStore(selectTerminals)
	const groups = useTerminalStore(selectTerminalGroups)
	const activeTerminalId = useTerminalStore(selectActiveTerminalId)
	const activeGroupId = useTerminalStore(selectActiveGroupId)
	const visibleTerminalIds = useTerminalStore(selectVisibleTerminalIds)
	const isActiveGroupFull = useTerminalStore(selectIsActiveGroupFull)
	const newTerminal = useTerminalStore((s) => s.newTerminal)
	const splitTerminal = useTerminalStore((s) => s.splitTerminal)
	const closeTerminal = useTerminalStore((s) => s.closeTerminal)
	const setActiveTerminal = useTerminalStore((s) => s.setActiveTerminal)
	const togglePanel = useTerminalStore((s) => s.togglePanel)
	const setPanelHeight = useTerminalStore((s) => s.setPanelHeight)
	const setPanelTransitioning = useTerminalStore((s) => s.setPanelTransitioning)

	const hasSidebar = terminals.length > 1
	const isSplitView = visibleTerminalIds.length > 1

	// Stable "Terminal N" labels based on position in the flat list
	const labelById = useMemo(() => {
		const m = new Map<string, string>()
		terminals.forEach((t, i) => m.set(t.id, `Terminal ${i + 1}`))
		return m
	}, [terminals])

	// Show group headers once any group has >1 terminal or there are multiple groups
	const showGroupHeaders = groups.length > 1 || groups.some((g) => g.terminalIds.length > 1)

	// Drag-resize state
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

	const handleSplit = useCallback(() => {
		if (isActiveGroupFull) return
		splitTerminal().catch((err) => console.error("[terminal] split failed:", err))
	}, [isActiveGroupFull, splitTerminal])

	const handleNew = useCallback(() => {
		newTerminal().catch((err) => console.error("[terminal] new failed:", err))
	}, [newTerminal])

	const handleCloseActive = useCallback(() => {
		if (activeTerminalId) closeTerminal(activeTerminalId)
	}, [activeTerminalId, closeTerminal])

	const handleCloseOne = useCallback(
		(e: MouseEvent, id: string) => {
			e.stopPropagation()
			closeTerminal(id)
		},
		[closeTerminal],
	)

	const transition = isDragging ? "none" : "height 200ms ease"

	const splitLabel = isActiveGroupFull
		? `Split (max ${MAX_TERMINALS_PER_GROUP} per group)`
		: "Split terminal"

	// Suppress xterm fits during the height animation. Without this, each
	// xterm's ResizeObserver fires fit() multiple times across the 200ms
	// transition — the single most expensive thing happening on toggle.
	// `setPanelTransitioning(false)` on transitionend lets a final fit run.
	const handleTransitionStart = useCallback(
		(e: ReactTransitionEvent<HTMLDivElement>) => {
			if (e.propertyName === "height" && e.target === e.currentTarget) {
				setPanelTransitioning(true)
			}
		},
		[setPanelTransitioning],
	)
	const handleTransitionEnd = useCallback(
		(e: ReactTransitionEvent<HTMLDivElement>) => {
			if (e.propertyName === "height" && e.target === e.currentTarget) {
				setPanelTransitioning(false)
			}
		},
		[setPanelTransitioning],
	)
	// Backstop: if transitionend never fires (interrupted by drag, no
	// actual height change, browser quirk), force-clear after the
	// longest possible transition window so xterm can refit. Also,
	// dragging overrides transition state — fits must run during drag.
	// biome-ignore lint/correctness/useExhaustiveDependencies: panelOpen is the trigger that should restart the backstop window
	useEffect(() => {
		if (isDragging) {
			setPanelTransitioning(false)
			return
		}
		const timer = setTimeout(() => setPanelTransitioning(false), 260)
		return () => clearTimeout(timer)
	}, [panelOpen, isDragging, setPanelTransitioning])

	return (
		<div
			className={cn(
				"flex shrink-0 flex-col overflow-hidden bg-terminal-bg",
				// `contain` isolates the height animation's reflow/repaint
				// to the panel — the AppShell layout above stays stable.
				"[contain:layout_paint_style]",
				panelOpen && "shadow-[inset_0_1px_0_0_var(--separator)]",
			)}
			style={{
				height: panelOpen ? panelHeight : 0,
				transition,
			}}
			onTransitionStart={handleTransitionStart}
			onTransitionEnd={handleTransitionEnd}
		>
			{/* Resize handle */}
			<div
				className="group flex h-1.5 shrink-0 cursor-row-resize items-center justify-center hover:bg-accent/20"
				onMouseDown={handleDragStart}
			>
				<div className="h-0.5 w-8 rounded-full bg-border transition-colors group-hover:bg-accent/60" />
			</div>

			{/* Content: viewport | sidebar. Flex-1 + min-h-0 avoids the
			    `calc(100% - 6px)` percentage trick, which forced a layout
			    recalc on every animation frame. */}
			<div className="relative flex min-h-0 flex-1">
				{/* Viewport area */}
				<div className="relative min-w-0 flex-1">
					{terminals.length === 0 ? (
						<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
							No active terminals
						</div>
					) : (
						terminals.map((t) => {
							const idx = visibleTerminalIds.indexOf(t.id)
							const visible = idx >= 0
							const cellStyle: CSSProperties = visible
								? {
										left: `${(idx / visibleTerminalIds.length) * 100}%`,
										width: `${100 / visibleTerminalIds.length}%`,
										visibility: "visible",
									}
								: {
										left: "-100%",
										width: `${100 / Math.max(1, visibleTerminalIds.length)}%`,
										visibility: "hidden",
									}
							const isActive = t.id === activeTerminalId
							return (
								<div
									key={t.id}
									className={cn(
										"absolute top-0 bottom-0 border-l first:border-l-0",
										visible && isSplitView && isActive && "border-border",
										visible && isSplitView && !isActive && "border-border/70",
										!visible && "pointer-events-none",
									)}
									style={cellStyle}
									onMouseDown={() => {
										if (visible && !isActive) setActiveTerminal(t.id)
									}}
								>
									<div className="h-full w-full p-1">
										<TerminalInstance terminalId={t.id} visible={visible} />
									</div>
								</div>
							)
						})
					)}

					{/* Floating action cluster (no sidebar) */}
					{!hasSidebar && terminals.length > 0 && (
						<div className="absolute right-2 top-2 z-10 inline-flex h-8 items-center gap-0.5 rounded-md border border-border bg-background/80 px-1 shadow-sm">
							<ActionButton onClick={handleSplit} disabled={isActiveGroupFull} label={splitLabel}>
								<Sidebar className="h-3.5 w-3.5" aria-hidden="true" />
							</ActionButton>
							<ActionButton onClick={handleNew} label="New terminal">
								<Plus className="h-3.5 w-3.5" aria-hidden="true" />
							</ActionButton>
							<ActionButton onClick={handleCloseActive} label="Close terminal">
								<Trash className="h-3.5 w-3.5" aria-hidden="true" />
							</ActionButton>
							<ActionButton onClick={togglePanel} label="Close panel">
								<X className="h-3.5 w-3.5" aria-hidden="true" />
							</ActionButton>
						</div>
					)}
				</div>

				{/* Sidebar (only when >1 terminal) */}
				{hasSidebar && (
					<aside className="flex w-36 min-w-36 shrink-0 flex-col border-l border-border bg-background/30">
						<div className="flex h-8 items-center justify-end gap-0.5 border-b border-border px-1">
							<ActionButton onClick={handleSplit} disabled={isActiveGroupFull} label={splitLabel}>
								<Sidebar className="h-3.5 w-3.5" aria-hidden="true" />
							</ActionButton>
							<ActionButton onClick={handleNew} label="New terminal">
								<Plus className="h-3.5 w-3.5" aria-hidden="true" />
							</ActionButton>
							<ActionButton onClick={handleCloseActive} label="Close terminal">
								<Trash className="h-3.5 w-3.5" aria-hidden="true" />
							</ActionButton>
							<ActionButton onClick={togglePanel} label="Close panel">
								<X className="h-3.5 w-3.5" aria-hidden="true" />
							</ActionButton>
						</div>

						<div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
							{groups.map((group, groupIdx) => {
								const isGroupActive = group.id === activeGroupId
								const groupJumpTerminal = isGroupActive
									? (activeTerminalId ?? group.terminalIds[0])
									: group.terminalIds[0]
								const groupLabel =
									group.terminalIds.length > 1
										? `SPLIT ${groupIdx + 1}`
										: `TERMINAL ${groupIdx + 1}`
								return (
									<div key={group.id} className="pb-1">
										{showGroupHeaders && (
											<button
												type="button"
												onClick={() => {
													if (groupJumpTerminal) setActiveTerminal(groupJumpTerminal)
												}}
												className={cn(
													"flex w-full items-center rounded px-1.5 py-1 text-[10px] font-medium uppercase tracking-[0.08em] transition-colors",
													isGroupActive
														? "bg-surface-hover text-foreground"
														: "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
												)}
											>
												{groupLabel}
											</button>
										)}
										<div className={cn(showGroupHeaders && "ml-2 border-l border-border/60 pl-2")}>
											{group.terminalIds.map((tid) => {
												const isActive = tid === activeTerminalId
												return (
													<div
														key={tid}
														className={cn(
															"group/row flex items-center gap-1.5 rounded px-1.5 py-1 text-xs transition-colors",
															isActive
																? "bg-surface-hover text-foreground"
																: "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
														)}
													>
														<button
															type="button"
															onClick={() => setActiveTerminal(tid)}
															className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
														>
															<Terminal className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
															<span className="truncate">{labelById.get(tid) ?? "Terminal"}</span>
														</button>
														<button
															type="button"
															onClick={(e) => handleCloseOne(e, tid)}
															className="flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-surface-hover hover:text-foreground group-hover/row:opacity-100"
															aria-label={`Close ${labelById.get(tid) ?? "terminal"}`}
														>
															<X className="h-2.5 w-2.5" aria-hidden="true" />
														</button>
													</div>
												)
											})}
										</div>
									</div>
								)
							})}
						</div>
					</aside>
				)}
			</div>
		</div>
	)
}

interface ActionButtonProps {
	children: React.ReactNode
	onClick: () => void
	label: string
	disabled?: boolean
}

function ActionButton({ children, onClick, label, disabled }: ActionButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={label}
			title={label}
			className={cn(
				"inline-flex h-6 items-center rounded-md px-2 text-muted-foreground transition-colors",
				disabled ? "cursor-not-allowed opacity-45" : "hover:bg-surface-hover hover:text-foreground",
			)}
		>
			{children}
		</button>
	)
}
