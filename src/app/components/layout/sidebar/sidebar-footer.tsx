import { SettingsCog } from "@openai/apps-sdk-ui/components/Icon"

export interface SidebarFooterProps {
	onOpenSettings: () => void
}

/** Settings link pinned to the bottom of the sidebar. */
export function SidebarFooter({ onOpenSettings }: SidebarFooterProps) {
	return (
		<div className="px-2 pb-3 pt-1">
			<button
				type="button"
				className="el-surface-hover flex w-full items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
				onClick={onOpenSettings}
			>
				<SettingsCog className="h-3.5 w-3.5" aria-hidden="true" />
				<span>Settings</span>
			</button>
		</div>
	)
}
