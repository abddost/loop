import { Check, ChevronDown, ShieldCheck } from "@openai/apps-sdk-ui/components/Icon"
import { useEffect, useRef, useState } from "react"
import { cn } from "../ui/cn"

/**
 * Permission mode values.
 *
 * The full union covers both AI SDK and Claude Code providers:
 *   - "default" / "full-access" — Loop's own tool permission system (AI SDK).
 *   - "auto-accept-edits" / "plan" — Claude Code SDK modes only.
 *
 * The status bar selector only shows modes relevant to AI SDK providers
 * ("Default" / "Full Access"). Claude Code sessions use the input-bar
 * PermissionModeSelector which shows all 4 modes.
 */
export type PermissionModeValue = "default" | "auto-accept-edits" | "full-access" | "plan"

export interface PermissionModeProps {
	value: PermissionModeValue
	onChange: (mode: PermissionModeValue) => void
	className?: string
}

/** Modes shown in the status bar (AI SDK providers only). */
const STATUS_BAR_MODES: Array<{ value: PermissionModeValue; label: string }> = [
	{ value: "default", label: "Default" },
	{ value: "full-access", label: "Full Access" },
]

export function PermissionMode({ value, onChange, className }: PermissionModeProps) {
	const [open, setOpen] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)

	// Clamp to a valid status-bar mode. If the session has a Claude-Code-only
	// mode (e.g. "plan" from a prior provider switch), fall back to "default".
	const effectiveValue = STATUS_BAR_MODES.some((m) => m.value === value) ? value : "default"
	const currentMode =
		STATUS_BAR_MODES.find((m) => m.value === effectiveValue) ?? STATUS_BAR_MODES[0]

	useEffect(() => {
		if (!open) return
		const handler = (e: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setOpen(false)
			}
		}
		document.addEventListener("mousedown", handler)
		return () => document.removeEventListener("mousedown", handler)
	}, [open])

	useEffect(() => {
		if (!open) return
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false)
		}
		document.addEventListener("keydown", handler)
		return () => document.removeEventListener("keydown", handler)
	}, [open])

	return (
		<div className="relative" ref={containerRef}>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className={cn(
					"el-surface-hover flex items-center gap-1.5 px-1.5 py-0.5 text-xs text-muted transition-all hover:text-foreground",
					open && "bg-[var(--app-surface-hover)] text-foreground",
					className,
				)}
				aria-label="Permission mode"
				aria-expanded={open}
			>
				<ShieldCheck className="h-3 w-3 shrink-0" aria-hidden="true" />
				<span>{currentMode.label}</span>
				<ChevronDown
					className={cn("h-2.5 w-2.5 shrink-0 transition-transform", open && "rotate-180")}
					aria-hidden="true"
				/>
			</button>
			{open && (
				<div
					className={cn(
						"absolute bottom-full right-0 z-50 mb-1 w-[160px] overflow-hidden rounded-xl",
						"el-dropdown shadow-[var(--shadow-dropdown)]",
						"animate-in fade-in slide-in-from-bottom-2 duration-150",
					)}
				>
					<div className="py-1">
						{STATUS_BAR_MODES.map((mode) => {
							const isSelected = mode.value === effectiveValue
							return (
								<button
									key={mode.value}
									type="button"
									onClick={() => {
										onChange(mode.value)
										setOpen(false)
									}}
									className={cn(
										"flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-hover",
										isSelected ? "text-foreground" : "text-overlay-foreground",
									)}
								>
									<span className="flex-1 truncate">{mode.label}</span>
									{isSelected && (
										<Check className="h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
									)}
								</button>
							)
						})}
					</div>
				</div>
			)}
		</div>
	)
}
