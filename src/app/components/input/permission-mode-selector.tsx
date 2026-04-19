import { Check, ChevronDown, ShieldCheck } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { PermissionModeValue } from "../status-bar/permission-mode"
import { cn } from "../ui/cn"

const MODES: Array<{ value: PermissionModeValue; label: string; short: string }> = [
	{ value: "default", label: "Ask permissions", short: "Ask" },
	{ value: "auto-accept-edits", label: "Accept edits", short: "Accept" },
	{ value: "plan", label: "Plan mode", short: "Plan" },
	{ value: "full-access", label: "Bypass permissions", short: "Bypass" },
]

export interface PermissionModeSelectorProps {
	value: PermissionModeValue
	onChange: (mode: PermissionModeValue) => void
	className?: string
}

/**
 * Compact permission mode selector for the input bar.
 * Shown only when the selected model is a Claude Code model.
 * Replaces the agent selector since Claude Code manages its own agents.
 */
export function PermissionModeSelector({
	value,
	onChange,
	className,
}: PermissionModeSelectorProps) {
	const [open, setOpen] = useState(false)
	const [highlightIdx, setHighlightIdx] = useState(() => MODES.findIndex((m) => m.value === value))
	const triggerRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)

	const current = MODES.find((m) => m.value === value) ?? MODES[0]

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

	// Focus panel when opening
	useEffect(() => {
		if (open) {
			requestAnimationFrame(() => panelRef.current?.focus())
			setHighlightIdx(MODES.findIndex((m) => m.value === value))
		}
	}, [open, value])

	const handleSelect = useCallback(
		(mode: PermissionModeValue) => {
			onChange(mode)
			setOpen(false)
		},
		[onChange],
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
				setHighlightIdx((prev) => Math.min(prev + 1, MODES.length - 1))
				return
			}
			if (e.key === "ArrowUp") {
				e.preventDefault()
				setHighlightIdx((prev) => Math.max(prev - 1, 0))
				return
			}
			if (e.key === "Enter") {
				e.preventDefault()
				const mode = MODES[highlightIdx]
				if (mode) handleSelect(mode.value)
			}
		},
		[highlightIdx, handleSelect],
	)

	// Panel positioning
	const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({})
	useLayoutEffect(() => {
		if (!open || !triggerRef.current) return
		const rect = triggerRef.current.getBoundingClientRect()
		setPanelStyle({
			position: "fixed",
			bottom: window.innerHeight - rect.top + 4,
			left: rect.left,
			minWidth: Math.max(rect.width, 160),
			maxWidth: 220,
			zIndex: 50,
		})
	}, [open])

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen(!open)}
				className={cn(
					"flex items-center gap-1 rounded-lg px-2 py-1 text-muted transition-colors hover:bg-surface-hover hover:text-foreground",
					className,
				)}
			>
				<ShieldCheck className="h-3 w-3" aria-hidden="true" />
				<span>{current.short}</span>
				<ChevronDown className="h-2.5 w-2.5" aria-hidden="true" />
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
						<div className="py-1">
							{MODES.map((mode, idx) => (
								<button
									key={mode.value}
									type="button"
									onClick={() => handleSelect(mode.value)}
									onMouseEnter={() => setHighlightIdx(idx)}
									className={cn(
										"el-surface-hover flex w-full items-center justify-between px-3 py-1.5 text-left text-sm",
										idx === highlightIdx
											? "bg-[var(--app-surface-hover)] text-foreground"
											: "text-foreground/80",
										mode.value === value && "font-medium text-accent",
									)}
								>
									<span>{mode.label}</span>
									{mode.value === value && (
										<Check className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
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
