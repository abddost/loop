import type { Agent } from "@core/schema/agent"
import { Check, ChevronDown } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { cn } from "../ui/cn"

export interface AgentSelectorProps {
	agents: Agent[]
	selectedAgentName?: string
	onSelect: (agentName: string) => void
	className?: string
	direction?: "up" | "down"
}

/**
 * Lightweight agent selector popover. Similar to ModelSelector but without
 * search or grouping — just a flat list of primary agents.
 */
export function AgentSelector({
	agents,
	selectedAgentName,
	onSelect,
	className,
	direction = "up",
}: AgentSelectorProps) {
	const primaryAgents = agents.filter((a) => a.type === "primary")
	const [open, setOpen] = useState(false)
	const [highlightIdx, setHighlightIdx] = useState(0)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const scrollRef = useRef<HTMLDivElement>(null)

	if (primaryAgents.length === 0) return null

	const selectedLabel = selectedAgentName
		? selectedAgentName.charAt(0).toUpperCase() + selectedAgentName.slice(1)
		: "Agent"

	// Close on outside click
	useEffect(() => {
		if (!open) return
		const handler = (e: MouseEvent) => {
			if (
				triggerRef.current?.contains(e.target as Node) ||
				panelRef.current?.contains(e.target as Node)
			)
				return
			setOpen(false)
		}
		document.addEventListener("mousedown", handler)
		return () => document.removeEventListener("mousedown", handler)
	}, [open])

	// Focus panel when opening, reset state when closing
	useEffect(() => {
		if (open) {
			requestAnimationFrame(() => panelRef.current?.focus())
		} else {
			setHighlightIdx(0)
		}
	}, [open])

	const handleSelect = useCallback(
		(agentName: string) => {
			onSelect(agentName)
			setOpen(false)
		},
		[onSelect],
	)

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault()
				setOpen(false)
				return
			}
			if (e.key === "ArrowDown") {
				e.preventDefault()
				setHighlightIdx((prev) => Math.min(prev + 1, primaryAgents.length - 1))
				return
			}
			if (e.key === "ArrowUp") {
				e.preventDefault()
				setHighlightIdx((prev) => Math.max(prev - 1, 0))
				return
			}
			if (e.key === "Enter") {
				e.preventDefault()
				const agent = primaryAgents[highlightIdx]
				if (agent) handleSelect(agent.name)
			}
		},
		[primaryAgents, highlightIdx, handleSelect],
	)

	// Panel positioning
	const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({})
	useLayoutEffect(() => {
		if (!open || !triggerRef.current) return
		const rect = triggerRef.current.getBoundingClientRect()
		const minW = Math.max(rect.width, 160)
		if (direction === "up") {
			setPanelStyle({
				position: "fixed",
				bottom: window.innerHeight - rect.top + 4,
				left: rect.left,
				minWidth: minW,
				maxWidth: 280,
				zIndex: 50,
			})
		} else {
			setPanelStyle({
				position: "fixed",
				top: rect.bottom + 4,
				left: rect.left,
				minWidth: minW,
				maxWidth: 280,
				zIndex: 50,
			})
		}
	}, [open, direction])

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen(!open)}
				className={cn(
					"flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-muted transition-colors hover:bg-surface-hover hover:text-foreground",
					className,
				)}
			>
				<span className="max-w-[120px] truncate">{selectedLabel}</span>
				<ChevronDown className="w-2.5 h-2.5" aria-hidden="true" />
			</button>

			{open &&
				createPortal(
					<div
						ref={panelRef}
						style={panelStyle}
						className="el-dropdown"
						onKeyDown={handleKeyDown}
						tabIndex={-1}
					>
						<div ref={scrollRef} className="max-h-[240px] overflow-y-auto py-1">
							{primaryAgents.map((agent, idx) => (
								<button
									key={agent.name}
									type="button"
									onClick={() => handleSelect(agent.name)}
									onMouseEnter={() => setHighlightIdx(idx)}
									className={cn(
										"el-surface-hover flex w-full items-center justify-between px-3 py-1.5 text-left text-sm",
										idx === highlightIdx
											? "bg-[var(--app-surface-hover)] text-foreground"
											: "text-foreground/80",
										agent.name === selectedAgentName && "font-medium text-accent",
									)}
								>
									<span className="truncate">
										{agent.name.charAt(0).toUpperCase() + agent.name.slice(1)}
									</span>
									{agent.name === selectedAgentName && (
										<Check className="w-3.5 h-3.5 shrink-0 text-accent" aria-hidden="true" />
									)}
								</button>
							))}
						</div>
					</div>,
					document.body,
				)}
		</>
	)
}
