import { cn } from "../ui/cn"

export interface TitlebarProps {
	className?: string
}

/**
 * Custom titlebar with drag region and traffic light spacing.
 * 40px height matching the content titlebar for vertical alignment.
 */
export function Titlebar({ className }: TitlebarProps) {
	return (
		<div
			style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
			className={cn("flex h-10 shrink-0 items-center pl-[72px] pr-3", "select-none", className)}
		/>
	)
}
