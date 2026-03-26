import { SettingsCog } from "@openai/apps-sdk-ui/components/Icon"

export interface SidebarFooterProps {
	onOpenSettings: () => void
}

/** Settings link pinned to the bottom of the sidebar. */
export function SidebarFooter({ onOpenSettings }: SidebarFooterProps) {
	return (
		<div className="border-t border-border px-2 py-2">
			<button
				type="button"
				className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-hover hover:text-foreground"
				onClick={onOpenSettings}
			>
				{/* Gear icon */}
				<SettingsCog className="h-3.5 w-3.5" aria-hidden="true" />
				<span>Settings</span>
			</button>
		</div>
	)
}
