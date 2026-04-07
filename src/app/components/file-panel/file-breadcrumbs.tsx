import {
	selectActiveFileUri,
	selectOpenFiles,
	useFilePanelStore,
} from "../../stores/file-panel-store"
import { FileIcon } from "../chat/file-icon"

export function FileBreadcrumbs() {
	const activeUri = useFilePanelStore(selectActiveFileUri)
	const openFiles = useFilePanelStore(selectOpenFiles)

	const activeFile = openFiles.find((f) => f.uri === activeUri)
	if (!activeFile) return null

	const segments = activeFile.path.split("/")

	// Build cumulative paths for stable keys (segments don't reorder)
	const cumulativePaths: string[] = []
	for (let i = 0; i < segments.length; i++) {
		cumulativePaths.push(i === 0 ? segments[i] : `${cumulativePaths[i - 1]}/${segments[i]}`)
	}

	return (
		<div className="flex h-6 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/30 px-3 text-[11px] text-muted">
			{segments.map((segment, i) => (
				<span key={cumulativePaths[i]} className="flex items-center gap-0.5">
					{i > 0 && <span className="mx-0.5 text-border">/</span>}
					{i === segments.length - 1 ? (
						<span className="flex items-center gap-1 text-foreground">
							<FileIcon filePath={activeFile.path} size={12} />
							{segment}
						</span>
					) : (
						<span className="cursor-default transition-colors hover:text-foreground">
							{segment}
						</span>
					)}
				</span>
			))}
		</div>
	)
}
