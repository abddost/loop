import { Check, ChevronDown, ShieldCheck } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { PermissionModeValue } from "../status-bar/permission-mode"
import { cn } from "../ui/cn"

interface ModeDef {
	value: PermissionModeValue
	label: string
	short: string
}

const ALL_MODES: ReadonlyArray<ModeDef> = [
	{ value: "default", label: "Ask permissions", short: "Ask" },
	{ value: "auto-accept-edits", label: "Accept edits", short: "Accept" },
	{ value: "plan", label: "Plan mode", short: "Plan" },
	{ value: "full-access", label: "Bypass permissions", short: "Bypass" },
]

/**
 * Modes available per provider kind.
 *
 * - Claude Code SDK: all four modes (Anthropic SDK natively supports
 *   plan + auto-accept-edits via setPermissionMode()).
 * - Cursor (ACP): default / plan / full-access. "auto-accept-edits"
 *   is a Claude-only concept and Cursor's own ACP mode system enforces
 *   the read-only constraint when plan mode is selected.
 * - Other AI SDK providers: default / full-access only — Loop's own
 *   permission gate handles edit approval inline.
 */
function modesForProvider(provider: ProviderKind): ReadonlyArray<ModeDef> {
	switch (provider) {
		case "claude-code":
			return ALL_MODES
		case "cursor":
			return ALL_MODES.filter((m) => m.value !== "auto-accept-edits")
		default:
			return ALL_MODES.filter((m) => m.value === "default" || m.value === "full-access")
	}
}

export type ProviderKind = "claude-code" | "cursor" | "ai-sdk" | "opencode" | string

export interface PermissionModeSelectorProps {
	value: PermissionModeValue
	onChange: (mode: PermissionModeValue) => void
	className?: string
	provider?: ProviderKind
}

export function PermissionModeSelector({
	value,
	onChange,
	className,
	provider = "claude-code",
}: PermissionModeSelectorProps) {
	const MODES = useMemo(() => modesForProvider(provider), [provider])
	const [open, setOpen] = useState(false)
	const [highlightIdx, setHighlightIdx] = useState(() => {
		const idx = MODES.findIndex((m) => m.value === value)
		return idx >= 0 ? idx : 0
	})
	const triggerRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)

	const current = MODES.find((m) => m.value === value) ?? MODES[0]

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
			setHighlightIdx(MODES.findIndex((m) => m.value === value))
		}
	}, [open, value, MODES])

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
		[highlightIdx, handleSelect, MODES],
	)

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
					"flex items-center gap-1 rounded px-1.5 py-0.5 text-muted transition-colors hover:text-foreground",
					className,
				)}
			>
				<ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
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
							<span className="text-xs text-muted">Permission</span>
						</div>
						<div className="pb-1.5">
							{MODES.map((mode, idx) => (
								<button
									key={mode.value}
									type="button"
									onClick={() => handleSelect(mode.value)}
									onMouseEnter={() => setHighlightIdx(idx)}
									className={cn(
										"flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors",
										idx === highlightIdx
											? "bg-[var(--app-surface-hover)] text-foreground"
											: "text-foreground",
										mode.value === value && "font-medium",
									)}
								>
									<span>{mode.label}</span>
									{mode.value === value && (
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
