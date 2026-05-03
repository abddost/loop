import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useSnackbarStore } from "../../../stores/snackbar-store"

interface SessionContextMenuProps {
	x: number
	y: number
	sessionId: string
	directory: string
	onClose: () => void
	onStartRename: () => void
}

/**
 * Right-click context menu for sidebar session items.
 * Pin and archive live as icon buttons on the row, so this menu
 * only exposes rename and clipboard copy actions.
 */
export function SessionContextMenu({
	x,
	y,
	sessionId,
	directory,
	onClose,
	onStartRename,
}: SessionContextMenuProps) {
	const panelRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (panelRef.current?.contains(e.target as Node)) return
			onClose()
		}
		document.addEventListener("mousedown", handler)
		return () => document.removeEventListener("mousedown", handler)
	}, [onClose])

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose()
		}
		document.addEventListener("keydown", handler)
		return () => document.removeEventListener("keydown", handler)
	}, [onClose])

	// Flip the menu so it stays inside the viewport.
	const [pos, setPos] = useState({ top: y, left: x })
	useLayoutEffect(() => {
		if (!panelRef.current) return
		const rect = panelRef.current.getBoundingClientRect()
		const margin = 8
		let top = y
		let left = x
		if (left + rect.width > window.innerWidth - margin) {
			left = Math.max(margin, window.innerWidth - rect.width - margin)
		}
		if (top + rect.height > window.innerHeight - margin) {
			top = Math.max(margin, window.innerHeight - rect.height - margin)
		}
		setPos({ top, left })
	}, [x, y])

	const copyToClipboard = (text: string, label: string) => {
		onClose()
		navigator.clipboard.writeText(text).then(
			() => useSnackbarStore.getState().push(`${label} copied`, "success", 2000),
			() => useSnackbarStore.getState().push("Failed to copy", "error", 2000),
		)
	}

	return createPortal(
		<div
			ref={panelRef}
			onContextMenu={(e) => e.preventDefault()}
			style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 50 }}
			className="el-dropdown w-44 rounded-xl py-1.5 animate-in fade-in zoom-in-95 duration-100"
		>
			<MenuItem
				label="Rename thread"
				onClick={() => {
					onClose()
					onStartRename()
				}}
			/>

			<div className="my-1 h-px bg-border/60" />

			<MenuItem
				label="Copy working directory"
				onClick={() => copyToClipboard(directory, "Directory")}
			/>
			<MenuItem label="Copy session ID" onClick={() => copyToClipboard(sessionId, "Session ID")} />
		</div>,
		document.body,
	)
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="el-surface-hover w-full px-3 py-1 text-left text-[13px] text-foreground/85 transition-colors"
		>
			{label}
		</button>
	)
}
