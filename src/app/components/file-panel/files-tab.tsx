import { useCallback, useEffect, useRef, useState } from "react"
import {
	selectActiveFileUri,
	selectOpenFiles,
	useFilePanelStore,
} from "../../stores/file-panel-store"
import type { CursorInfo } from "./codemirror-viewer"
import { FileBreadcrumbs } from "./file-breadcrumbs"
import { FileEditor } from "./file-editor"
import { FileStatusBar } from "./file-status-bar"
import { FileTabs } from "./file-tabs"
import { FileTree } from "./file-tree"

export function FilesTab() {
	const treeWidth = useFilePanelStore((s) => s.treeWidth)
	const setTreeWidth = useFilePanelStore((s) => s.setTreeWidth)
	const activeUri = useFilePanelStore(selectActiveFileUri)
	const openFiles = useFilePanelStore(selectOpenFiles)
	const activeFile = openFiles.find((f) => f.uri === activeUri)

	const [cursor, setCursor] = useState<CursorInfo | null>(null)

	const dragging = useRef(false)
	const startX = useRef(0)
	const startWidth = useRef(0)
	const [isDragging, setIsDragging] = useState(false)

	const handleDragStart = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault()
			dragging.current = true
			startX.current = e.clientX
			startWidth.current = treeWidth
			setIsDragging(true)
			document.body.style.cursor = "col-resize"
			document.body.style.userSelect = "none"
		},
		[treeWidth],
	)

	useEffect(() => {
		const onMouseMove = (e: MouseEvent) => {
			if (!dragging.current) return
			const delta = e.clientX - startX.current
			setTreeWidth(startWidth.current + delta)
		}
		const onMouseUp = () => {
			if (!dragging.current) return
			dragging.current = false
			setIsDragging(false)
			document.body.style.cursor = ""
			document.body.style.userSelect = ""
		}
		document.addEventListener("mousemove", onMouseMove)
		document.addEventListener("mouseup", onMouseUp)
		return () => {
			document.removeEventListener("mousemove", onMouseMove)
			document.removeEventListener("mouseup", onMouseUp)
		}
	}, [setTreeWidth])

	const transition = isDragging ? "none" : "width 200ms ease"

	return (
		<div className="flex h-full">
			{/* File tree */}
			<div
				className="shrink-0 overflow-hidden border-r border-border/30"
				style={{ width: treeWidth, transition }}
			>
				<FileTree />
			</div>

			{/* Resize handle */}
			<div
				className="h-full w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-accent/30"
				onMouseDown={handleDragStart}
			/>

			{/* Editor area */}
			<div className="flex min-w-0 flex-1 flex-col">
				<FileTabs />
				<FileBreadcrumbs />
				<div className="min-h-0 flex-1">
					<FileEditor onCursorChange={setCursor} />
				</div>
				{activeFile && (
					<FileStatusBar
						language={activeFile.language}
						cursor={cursor}
						binary={activeFile.binary}
						dirty={activeFile.dirty}
						saving={activeFile.saving}
						saveError={activeFile.saveError}
					/>
				)}
			</div>
		</div>
	)
}
