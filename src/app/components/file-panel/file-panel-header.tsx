import { Branch, Folder, PopOutWindow, X } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback } from "react"
import { desktopBridge } from "../../lib/desktop-bridge"
import { isPopoutWindow } from "../../lib/popout"
import { selectChanges, useFilePanelStore } from "../../stores/file-panel-store"
import { useUIStore } from "../../stores/ui-store"
import { cn } from "../ui/cn"
import { Tooltip } from "../ui/tooltip"

export function FilePanelHeader() {
	const activeTab = useFilePanelStore((s) => s.activeTab)
	const setActiveTab = useFilePanelStore((s) => s.setActiveTab)
	const togglePanel = useFilePanelStore((s) => s.togglePanel)
	const changes = useFilePanelStore(selectChanges)
	const isPopout = isPopoutWindow()

	const handlePopout = useCallback(() => {
		const dir = useUIStore.getState().activeDirectory
		if (!dir) return
		desktopBridge.popoutFilePanel(dir, "Files")
	}, [])

	return (
		<div className="flex h-9 shrink-0 items-center justify-between shadow-[var(--shadow-inset)] px-2">
			{/* Tabs */}
			<div className="flex items-center gap-0.5">
				<TabButton
					active={activeTab === "changes"}
					onClick={() => setActiveTab("changes")}
					icon={<Branch className="h-3 w-3" />}
					label="Changes"
					badge={changes.length > 0 ? changes.length : undefined}
				/>
				<TabButton
					active={activeTab === "files"}
					onClick={() => setActiveTab("files")}
					icon={<Folder className="h-3 w-3" />}
					label="Files"
				/>
			</div>
			{/* Actions */}
			<div className="flex items-center gap-0.5">
				{!isPopout && (
					<Tooltip content="Open in separate window">
						<button
							type="button"
							onClick={handlePopout}
							className="el-surface-hover flex h-6 w-6 items-center justify-center text-muted hover:text-foreground"
						>
							<PopOutWindow className="h-3 w-3" />
						</button>
					</Tooltip>
				)}
				<Tooltip content={isPopout ? "Close window" : "Close panel"} shortcut="filePanel.toggle">
					<button
						type="button"
						onClick={isPopout ? () => desktopBridge.closePopout() : togglePanel}
						className="el-surface-hover flex h-6 w-6 items-center justify-center text-muted hover:text-foreground"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</Tooltip>
			</div>
		</div>
	)
}

function TabButton({
	active,
	onClick,
	icon,
	label,
	badge,
}: {
	active: boolean
	onClick: () => void
	icon: React.ReactNode
	label: string
	badge?: number
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"el-tab relative flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium",
				active ? "text-foreground" : "text-muted hover:text-foreground",
			)}
		>
			{icon}
			<span>{label}</span>
			{badge !== undefined && (
				<span className="rounded-full bg-accent/20 px-1.5 text-[10px] font-semibold text-accent">
					{badge}
				</span>
			)}
			{active && <div className="absolute bottom-0 left-1 right-1 h-0.5 rounded-full bg-accent" />}
		</button>
	)
}
