import { LOOP_PATH_DRAG_MIME, encodeLoopPathDrag } from "../../lib/file-utils"
import { getDirectoryIconUrl } from "../../lib/file-icons"
import {
	type FileEntry,
	selectIsExpanded,
	selectRootTree,
	selectTreeChildren,
	useFilePanelStore,
} from "../../stores/file-panel-store"
import { FileIcon } from "../chat/file-icon"
import { cn } from "../ui/cn"

export function FileTree() {
	const rootEntries = useFilePanelStore(selectRootTree)

	if (rootEntries.length === 0) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-xs text-muted">No files</p>
			</div>
		)
	}

	return (
		<div className="h-full overflow-y-auto py-1">
			{rootEntries.map((entry) => (
				<TreeNode key={entry.path} entry={entry} depth={0} />
			))}
		</div>
	)
}

function TreeNode({ entry, depth }: { entry: FileEntry; depth: number }) {
	const toggleExpand = useFilePanelStore((s) => s.toggleExpand)
	const openFile = useFilePanelStore((s) => s.openFile)

	const isExpanded = useFilePanelStore((s) => selectIsExpanded(s, entry.path))
	const children = useFilePanelStore((s) => selectTreeChildren(s, entry.path))

	const isDir = entry.type === "directory"

	const handleClick = () => {
		if (isDir) {
			toggleExpand(entry.path)
		} else {
			openFile(entry.path)
		}
	}

	const handleDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
		// Use a custom MIME so the chat-input drop handler can distinguish
		// internal drags (path-only references) from OS file drops (real
		// File objects). Falling back to text/plain ensures the path can
		// still be pasted into other targets if needed.
		const payload = encodeLoopPathDrag({ path: entry.path, isDirectory: isDir, name: entry.name })
		e.dataTransfer.setData(LOOP_PATH_DRAG_MIME, payload)
		e.dataTransfer.setData("text/plain", entry.path)
		e.dataTransfer.effectAllowed = "copy"
	}

	return (
		<div>
			<button
				type="button"
				draggable
				onDragStart={handleDragStart}
				onClick={handleClick}
				className={cn(
					"el-surface-hover flex w-full cursor-pointer items-center gap-1.5 px-2 py-[3px] text-xs",
				)}
				style={{ paddingLeft: depth * 16 + 8 }}
			>
				{isDir ? (
					<>
						{/* Chevron */}
						<svg
							className={cn(
								"h-3 w-3 shrink-0 text-muted transition-transform",
								isExpanded && "rotate-90",
							)}
							viewBox="0 0 16 16"
							fill="currentColor"
							aria-hidden="true"
						>
							<path
								d="M6 4l4 4-4 4"
								stroke="currentColor"
								fill="none"
								strokeWidth="1.5"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
						<img
							src={getDirectoryIconUrl(entry.name, isExpanded)}
							alt=""
							className="h-4 w-4 shrink-0"
							aria-hidden="true"
						/>
					</>
				) : (
					<>
						{/* Spacer for alignment with folders */}
						<span className="w-3 shrink-0" />
						<FileIcon filePath={entry.path} size={14} />
					</>
				)}
				<span className="truncate text-foreground">{entry.name}</span>
			</button>

			{/* Children (rendered if expanded) */}
			{isDir && isExpanded && children.length > 0 && (
				<div>
					{children.map((child) => (
						<TreeNode key={child.path} entry={child} depth={depth + 1} />
					))}
				</div>
			)}
		</div>
	)
}
