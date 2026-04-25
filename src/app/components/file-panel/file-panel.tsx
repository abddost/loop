import { useFilePanelStore } from "../../stores/file-panel-store"
import { FilePanelHeader } from "./file-panel-header"
import { FilesTab } from "./files-tab"
import { ReviewPanel } from "./review-panel"

export function FilePanel() {
	const activeTab = useFilePanelStore((s) => s.activeTab)

	return (
		<div className="flex h-full flex-col bg-background shadow-[inset_1px_0_0_0_var(--separator)]">
			<FilePanelHeader />
			<div className="min-h-0 flex-1 overflow-hidden">
				{activeTab === "changes" ? <ReviewPanel /> : <FilesTab />}
			</div>
		</div>
	)
}
