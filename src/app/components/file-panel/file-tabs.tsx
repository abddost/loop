import { X } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useState } from "react"
import {
	type OpenFile,
	selectActiveFileUri,
	selectOpenFiles,
	useFilePanelStore,
} from "../../stores/file-panel-store"
import { FileIcon } from "../chat/file-icon"
import { cn } from "../ui/cn"
import { UnsavedChangesModal } from "./unsaved-changes-modal"

export function FileTabs() {
	const openFiles = useFilePanelStore(selectOpenFiles)
	const activeUri = useFilePanelStore(selectActiveFileUri)
	const setActiveFile = useFilePanelStore((s) => s.setActiveFile)
	const closeFile = useFilePanelStore((s) => s.closeFile)
	const saveFile = useFilePanelStore((s) => s.saveFile)
	const discardChanges = useFilePanelStore((s) => s.discardChanges)

	const [pendingClose, setPendingClose] = useState<OpenFile | null>(null)

	const requestClose = useCallback(
		(file: OpenFile) => {
			if (file.dirty) {
				setPendingClose(file)
			} else {
				closeFile(file.uri)
			}
		},
		[closeFile],
	)

	if (openFiles.length === 0) return null

	return (
		<>
			<div className="flex h-8 shrink-0 items-center gap-0 overflow-x-auto shadow-[var(--shadow-inset)] bg-surface px-1">
				{openFiles.map((file) => {
					const isActive = file.uri === activeUri
					const fileName = file.path.split("/").pop() ?? file.path
					return (
						<FileTab
							key={file.uri}
							fileName={fileName}
							filePath={file.path}
							isActive={isActive}
							dirty={file.dirty}
							onClick={() => setActiveFile(file.uri)}
							onClose={() => requestClose(file)}
						/>
					)
				})}
			</div>
			{pendingClose && (
				<UnsavedChangesModal
					fileName={pendingClose.path.split("/").pop() ?? pendingClose.path}
					onSave={async () => {
						const uri = pendingClose.uri
						const ok = await saveFile(uri)
						if (ok) {
							closeFile(uri)
							setPendingClose(null)
						}
					}}
					onDiscard={() => {
						discardChanges(pendingClose.uri)
						closeFile(pendingClose.uri)
						setPendingClose(null)
					}}
					onCancel={() => setPendingClose(null)}
				/>
			)}
		</>
	)
}

function FileTab({
	fileName,
	filePath,
	isActive,
	dirty,
	onClick,
	onClose,
}: {
	fileName: string
	filePath: string
	isActive: boolean
	dirty: boolean
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
				"el-tab group/tab relative flex h-7 shrink-0 items-center gap-1.5 text-xs",
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
				className={cn(
					"mr-1 flex h-4 w-4 cursor-pointer items-center justify-center rounded transition-opacity",
					dirty
						? "opacity-100 hover:bg-foreground/10"
						: "opacity-0 hover:bg-foreground/10 group-hover/tab:opacity-100",
				)}
				aria-label={dirty ? `Close ${fileName} (unsaved changes)` : `Close ${fileName}`}
			>
				{dirty ? (
					<span className="h-1.5 w-1.5 rounded-full bg-foreground group-hover/tab:hidden" />
				) : null}
				<X className={cn("h-2 w-2", dirty ? "hidden group-hover/tab:block" : undefined)} />
			</button>
			{isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />}
		</div>
	)
}
