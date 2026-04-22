import type { ReasoningEffort } from "@core/schema/config"
import { Check, ChevronDown } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { cn } from "../ui/cn"

export type EffortLevel = { value: ReasoningEffort; label: string; short: string }

const DEFAULT_LEVELS: EffortLevel[] = [
	{ value: "low", label: "Low", short: "Low" },
	{ value: "medium", label: "Medium", short: "Med" },
	{ value: "high", label: "High", short: "High" },
	{ value: "xhigh", label: "Extra High", short: "Extra High" },
]

export interface ReasoningSelectorProps {
	value: ReasoningEffort
	onChange: (effort: ReasoningEffort) => void
	levels?: EffortLevel[]
	className?: string
}

export function ReasoningSelector({ value, onChange, levels, className }: ReasoningSelectorProps) {
	const effectiveLevels = useMemo(() => levels ?? DEFAULT_LEVELS, [levels])
	const [open, setOpen] = useState(false)
	const [highlightIdx, setHighlightIdx] = useState(() =>
		effectiveLevels.findIndex((l) => l.value === value),
	)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)

	const current = effectiveLevels.find((l) => l.value === value) ?? effectiveLevels[1]

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

	useEffect(() => {
		if (open) {
			requestAnimationFrame(() => panelRef.current?.focus())
			setHighlightIdx(effectiveLevels.findIndex((l) => l.value === value))
		}
	}, [open, value, effectiveLevels])

	const handleSelect = useCallback(
		(effort: ReasoningEffort) => {
			onChange(effort)
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
				setHighlightIdx((prev) => Math.min(prev + 1, effectiveLevels.length - 1))
				return
			}
			if (e.key === "ArrowUp") {
				e.preventDefault()
				setHighlightIdx((prev) => Math.max(prev - 1, 0))
				return
			}
			if (e.key === "Enter") {
				e.preventDefault()
				const level = effectiveLevels[highlightIdx]
				if (level) handleSelect(level.value)
			}
		},
		[highlightIdx, handleSelect, effectiveLevels],
	)

	const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({})
	useLayoutEffect(() => {
		if (!open || !triggerRef.current) return
		const rect = triggerRef.current.getBoundingClientRect()
		setPanelStyle({
			position: "fixed",
			bottom: window.innerHeight - rect.top + 4,
			left: rect.left,
			minWidth: Math.max(rect.width, 140),
			maxWidth: 180,
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
					"flex items-center gap-1 rounded px-1.5 py-0.5 text-muted transition-colors hover:text-foreground",
					className,
				)}
			>
				<svg
					className="h-3 w-3 shrink-0"
					viewBox="0 0 16 16"
					fill="none"
					xmlns="http://www.w3.org/2000/svg"
					aria-hidden="true"
				>
					<path
						d="M8 1a5.5 5.5 0 0 0-2 10.63V13a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-1.37A5.5 5.5 0 0 0 8 1ZM6 15h4"
						stroke="currentColor"
						strokeWidth="1.3"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
				<span>{current.short}</span>
				<ChevronDown className="h-2 w-2 shrink-0" aria-hidden="true" />
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
						<div className="px-3 pt-2.5 pb-1">
							<span className="text-xs text-muted">Effort</span>
						</div>
						<div className="pb-1.5">
							{effectiveLevels.map((level, idx) => (
								<button
									key={level.value}
									type="button"
									onClick={() => handleSelect(level.value)}
									onMouseEnter={() => setHighlightIdx(idx)}
									className={cn(
										"flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors",
										idx === highlightIdx
											? "bg-[var(--app-surface-hover)] text-foreground"
											: "text-foreground",
										level.value === value && "font-medium",
									)}
								>
									<span>{level.label}</span>
									{level.value === value && (
										<Check className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
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
