import type { ReactNode } from "react"
import { cn } from "../ui/cn"

export interface AppShellProps {
	sidebar: ReactNode
	children: ReactNode
	className?: string
}

/**
 * Main application layout: sidebar (left) + content area (right).
 * Uses CSS grid for a responsive two-column layout.
 */
export function AppShell({ sidebar, children, className }: AppShellProps) {
	return (
		<div
			className={cn(
				"grid h-screen w-screen grid-cols-[260px_1fr] overflow-hidden bg-background",
				className,
			)}
		>
			<aside className="flex h-full flex-col border-r border-border bg-surface">{sidebar}</aside>
			<main className="flex h-full flex-col overflow-hidden">{children}</main>
		</div>
	)
}
