import { SettingsCog } from "@openai/apps-sdk-ui/components/Icon"

export interface SidebarFooterProps {
	onOpenSettings: () => void
}

/** Settings link pinned to the bottom of the sidebar. */
export function SidebarFooter({ onOpenSettings }: SidebarFooterProps) {
	return (
		<div data-sidebar-footer className="px-2 pb-3 pt-2">
			<button
				type="button"
				className="el-surface-hover flex w-full items-center gap-2.5 px-2.5 py-1.5 text-[13px] font-medium text-foreground/80 hover:text-foreground"
				onClick={onOpenSettings}
			>
				<SettingsCog className="h-4 w-4" aria-hidden="true" />
				<span>Settings</span>
			</button>
		</div>
	)
}
