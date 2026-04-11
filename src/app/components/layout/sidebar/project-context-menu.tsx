import { DotsHorizontal, Pencil, Trash } from "@openai/apps-sdk-ui/components/Icon"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { cn } from "../../ui/cn"

interface ProjectContextMenuProps {
	onRename: () => void
	onRemove: () => void
}

/**
 * 3-dot context menu for project items in the sidebar.
 * Shows Rename and Remove actions.
 */
export function ProjectContextMenu({ onRename, onRemove }: ProjectContextMenuProps) {
	const [open, setOpen] = useState(false)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)

	// Close on outside click
	useEffect(() => {
		if (!open) return
		const handler = (e: MouseEvent) => {
			if (
				triggerRef.current?.contains(e.target as Node) ||
				panelRef.current?.contains(e.target as Node)
			)
				return
			setOpen(false)
		}
		document.addEventListener("mousedown", handler)
		return () => document.removeEventListener("mousedown", handler)
	}, [open])

	// Close on Escape
	useEffect(() => {
		if (!open) return
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false)
		}
		document.addEventListener("keydown", handler)
		return () => document.removeEventListener("keydown", handler)
	}, [open])

	const rect = triggerRef.current?.getBoundingClientRect()

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				className={cn(
					"shrink-0 rounded-md p-0.5 text-muted transition-opacity hover:text-foreground",
					open ? "opacity-100" : "opacity-0 group-hover:opacity-100",
				)}
				onClick={(e) => {
					e.stopPropagation()
					setOpen(!open)
				}}
				aria-label="Project actions"
			>
				<DotsHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
			</button>

			{open &&
				rect &&
				createPortal(
					<div
						ref={panelRef}
						className="el-dropdown fixed z-50 min-w-[140px] py-1"
						style={{
							top: rect.bottom + 4,
							left: rect.left,
						}}
					>
						<button
							type="button"
							className="el-surface-hover flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground transition-colors"
							onClick={() => {
								setOpen(false)
								onRename()
							}}
						>
							<Pencil className="h-3 w-3 text-muted" aria-hidden="true" />
							Rename
						</button>
						<button
							type="button"
							className="el-surface-hover flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 transition-colors"
							onClick={() => {
								setOpen(false)
								onRemove()
							}}
						>
							<Trash className="h-3 w-3" aria-hidden="true" />
							Remove
						</button>
					</div>,
					document.body,
				)}
		</>
	)
}
