import { cn } from "../ui/cn"

export interface TitlebarProps {
	className?: string
}

/**
 * Custom titlebar for Tauri with drag region and traffic light spacing.
 * 32px height with left padding for macOS traffic lights.
 */
export function Titlebar({ className }: TitlebarProps) {
	return (
		<div
			data-tauri-drag-region
			className={cn("flex h-8 shrink-0 items-center pl-[72px] pr-3", "select-none", className)}
		/>
	)
}
