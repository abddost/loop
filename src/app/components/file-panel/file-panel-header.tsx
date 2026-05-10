import {
	Branch,
	Collapse,
	Expand,
	Folder,
	PopOutWindow,
	X,
} from "@openai/apps-sdk-ui/components/Icon"
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
	const panelExpanded = useFilePanelStore((s) => s.panelExpanded)
	const togglePanelExpanded = useFilePanelStore((s) => s.togglePanelExpanded)
	const changes = useFilePanelStore(selectChanges)
	const isPopout = isPopoutWindow()

	const handlePopout = useCallback(() => {
		const dir = useUIStore.getState().activeDirectory
		if (!dir) return
		desktopBridge.popoutFilePanel(dir, "Files")
	}, [])

	return (
		<div className="flex h-10 shrink-0 items-center justify-between px-2">
			{/* Tabs */}
			<div className="flex items-center gap-1">
				<TabButton
					active={activeTab === "changes"}
					onClick={() => setActiveTab("changes")}
					icon={<Branch className="h-4 w-4" />}
					label="Changes"
					badge={changes.length > 0 ? changes.length : undefined}
				/>
				<TabButton
					active={activeTab === "files"}
					onClick={() => setActiveTab("files")}
					icon={<Folder className="h-4 w-4" />}
					label="Files"
				/>
			</div>
			{/* Actions */}
			<div className="flex items-center gap-0.5">
				{!isPopout && (
					<Tooltip content={panelExpanded ? "Collapse panel" : "Expand panel"}>
						<button
							type="button"
							onClick={togglePanelExpanded}
							className="el-surface-hover flex h-7 w-7 items-center justify-center text-muted hover:text-foreground"
						>
							{panelExpanded ? (
								<Collapse className="h-3.5 w-3.5" />
							) : (
								<Expand className="h-3.5 w-3.5" />
							)}
						</button>
					</Tooltip>
				)}
				{!isPopout && (
					<Tooltip content="Open in separate window">
						<button
							type="button"
							onClick={handlePopout}
							className="el-surface-hover flex h-7 w-7 items-center justify-center text-muted hover:text-foreground"
						>
							<PopOutWindow className="h-3.5 w-3.5" />
						</button>
					</Tooltip>
				)}
				{/* Popout windows already have native window controls; only
				    show the in-app close button for the embedded panel. */}
				{!isPopout && (
					<Tooltip content="Close panel" shortcut="filePanel.toggle">
						<button
							type="button"
							onClick={togglePanel}
							className="el-surface-hover flex h-7 w-7 items-center justify-center text-muted hover:text-foreground"
						>
							<X className="h-4 w-4" />
						</button>
					</Tooltip>
				)}
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
				"el-tab flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
				active
					? "bg-surface-hover text-foreground"
					: "text-muted hover:bg-surface-hover/50 hover:text-foreground",
			)}
		>
			{icon}
			<span>{label}</span>
			{badge !== undefined && (
				<span
					className={cn(
						"rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
						active ? "bg-foreground/15 text-foreground" : "bg-foreground/10 text-muted",
					)}
				>
					{badge}
				</span>
			)}
		</button>
	)
}
