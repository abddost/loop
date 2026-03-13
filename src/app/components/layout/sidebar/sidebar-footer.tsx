export interface SidebarFooterProps {
	onOpenSettings: () => void
}

/** Settings link pinned to the bottom of the sidebar. */
export function SidebarFooter({ onOpenSettings }: SidebarFooterProps) {
	return (
		<div className="border-t border-border px-3 py-2">
			<button
				type="button"
				className="flex w-full items-center gap-2 rounded-[--radius-sm] px-2 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-foreground"
				onClick={onOpenSettings}
			>
				{/* Gear icon */}
				<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
					<circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.5" />
					<path
						d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.75 2.75l1.06 1.06M10.19 10.19l1.06 1.06M11.25 2.75l-1.06 1.06M3.81 10.19l-1.06 1.06"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
					/>
				</svg>
				<span>Settings</span>
			</button>
		</div>
	)
}
