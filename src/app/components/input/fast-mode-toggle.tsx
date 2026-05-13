import { useCallback } from "react"
import { cn } from "../ui/cn"
import { Tooltip } from "../ui/tooltip"

export interface FastModeToggleProps {
	enabled: boolean
	onChange: (enabled: boolean) => void
	className?: string
}

/**
 * Label + slide-switch for Claude Code "Fast mode". Sits next to the
 * ReasoningSelector and only renders when the active model advertises
 * `supportsFastMode` (currently Opus 4.6, Opus 4.6 1M, and Opus 4.7
 * 1M). The whole pill is the click target — clicking either the label
 * or the track flips state.
 *
 * Switch styling matches the project's existing `ToggleSwitch`
 * (settings/shared.tsx): an inset-shadowed track when off, the accent
 * fill when on, with a white thumb that slides between two positions.
 */
export function FastModeToggle({ enabled, onChange, className }: FastModeToggleProps) {
	const handleClick = useCallback(() => onChange(!enabled), [enabled, onChange])

	return (
		<Tooltip
			content={
				enabled
					? "Fast mode is on — short, low-latency responses."
					: "Enable fast mode — short, low-latency responses."
			}
			side="top"
		>
			<button
				type="button"
				role="switch"
				aria-checked={enabled}
				onClick={handleClick}
				className={cn(
					"flex h-7 shrink-0 items-center gap-2 rounded-full px-2.5 transition-colors",
					enabled
						? "text-foreground"
						: "text-muted-foreground hover:bg-foreground/6 hover:text-foreground",
					className,
				)}
			>
				<span className="font-medium">Fast mode</span>
				<span
					aria-hidden="true"
					className={cn(
						"relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full transition-colors",
						enabled ? "bg-accent" : "bg-default shadow-[var(--shadow-inset)]",
					)}
				>
					<span
						className={cn(
							"inline-block h-2.5 w-2.5 rounded-full bg-white shadow-sm transition-transform",
							enabled ? "translate-x-[12px]" : "translate-x-[2px]",
						)}
					/>
				</span>
			</button>
		</Tooltip>
	)
}
