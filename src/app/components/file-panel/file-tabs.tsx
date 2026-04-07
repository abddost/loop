import { X } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback } from "react"
import {
	selectActiveFileUri,
	selectOpenFiles,
	useFilePanelStore,
} from "../../stores/file-panel-store"
import { FileIcon } from "../chat/file-icon"
import { cn } from "../ui/cn"

export function FileTabs() {
	const openFiles = useFilePanelStore(selectOpenFiles)
	const activeUri = useFilePanelStore(selectActiveFileUri)
	const setActiveFile = useFilePanelStore((s) => s.setActiveFile)
	const closeFile = useFilePanelStore((s) => s.closeFile)

	if (openFiles.length === 0) return null

	return (
		<div className="flex h-8 shrink-0 items-center gap-0 overflow-x-auto border-b border-border/50 bg-surface px-1">
			{openFiles.map((file) => {
				const isActive = file.uri === activeUri
				const fileName = file.path.split("/").pop() ?? file.path
				return (
					<FileTab
						key={file.uri}
						fileName={fileName}
						filePath={file.path}
						isActive={isActive}
						onClick={() => setActiveFile(file.uri)}
						onClose={() => closeFile(file.uri)}
					/>
				)
			})}
		</div>
	)
}

function FileTab({
	fileName,
	filePath,
	isActive,
	onClick,
	onClose,
}: {
	fileName: string
	filePath: string
	isActive: boolean
	onClick: () => void
	onClose: () => void
}) {
	const handleClose = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			onClose()
		},
		[onClose],
	)

	return (
		<div
			className={cn(
				"group/tab relative flex h-7 shrink-0 items-center gap-1.5 rounded-md text-xs transition-colors",
				isActive
					? "bg-background/60 text-foreground"
					: "text-muted-foreground hover:text-foreground",
			)}
		>
			<button
				type="button"
				onClick={onClick}
				className="flex cursor-pointer items-center gap-1.5 py-1 pl-2"
			>
				<FileIcon filePath={filePath} size={12} />
				<span className="max-w-[100px] truncate">{fileName}</span>
			</button>
			<button
				type="button"
				onClick={handleClose}
				className="mr-1 flex h-4 w-4 cursor-pointer items-center justify-center rounded opacity-0 transition-opacity hover:bg-foreground/10 group-hover/tab:opacity-100"
				aria-label={`Close ${fileName}`}
			>
				<X className="h-2 w-2" />
			</button>
			{isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />}
		</div>
	)
}
