import {
	Archive,
	Copy,
	DotsHorizontalMoreMenu,
	Pencil,
	PinFilled,
} from "@openai/apps-sdk-ui/components/Icon"
import type { ReactNode } from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useKeybindLabel } from "../../hooks/use-keybinding"
import { usePinStore } from "../../stores/pin-store"
import { useSnackbarStore } from "../../stores/snackbar-store"
import { cn } from "../ui/cn"
import { Tooltip } from "../ui/tooltip"

interface TitlebarMenuProps {
	sessionId: string
	directory: string
	onStartRename: () => void
	onArchive: () => void
}

/**
 * Three-dot context menu for the content titlebar.
 * Provides pin, rename, archive, and clipboard copy actions.
 */
export function TitlebarMenu({
	sessionId,
	directory,
	onStartRename,
	onArchive,
}: TitlebarMenuProps) {
	const [open, setOpen] = useState(false)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const isPinned = usePinStore((s) => s.pinnedIds.has(sessionId))
	const togglePin = usePinStore((s) => s.togglePin)

	// Resolve shortcut labels from keybinding system (respects user overrides)
	const pinShortcut = useKeybindLabel("session.pin")
	const renameShortcut = useKeybindLabel("session.rename")
	const archiveShortcut = useKeybindLabel("session.archive")
	const copyDirShortcut = useKeybindLabel("session.copyDirectory")
	const copyIdShortcut = useKeybindLabel("session.copyId")

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

	// Position panel below trigger
	const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({})
	useEffect(() => {
		if (!open || !triggerRef.current) return
		const rect = triggerRef.current.getBoundingClientRect()
		setPanelStyle({
			position: "fixed",
			top: rect.bottom + 6,
			left: rect.left,
			minWidth: 240,
			zIndex: 50,
		})
	}, [open])

	const copyToClipboard = useCallback((text: string, label: string) => {
		setOpen(false)
		navigator.clipboard.writeText(text).then(
			() => useSnackbarStore.getState().push(`${label} copied`, "success", 2000),
			() => useSnackbarStore.getState().push("Failed to copy", "error", 2000),
		)
	}, [])

	return (
		<>
			<Tooltip content="More options">
				<button
					ref={triggerRef}
					type="button"
					onClick={() => setOpen(!open)}
					className={cn(
						"flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted transition-colors hover:text-foreground",
						open && "text-foreground",
					)}
					aria-label="More options"
				>
					<DotsHorizontalMoreMenu className="h-3.5 w-3.5" aria-hidden="true" />
				</button>
			</Tooltip>

			{open &&
				createPortal(
					<div
						ref={panelRef}
						style={panelStyle}
						className="el-dropdown rounded-xl py-1.5 animate-in fade-in zoom-in-95 duration-100"
					>
						<MenuItem
							icon={<PinFilled className="h-3.5 w-3.5" />}
							label={isPinned ? "Unpin thread" : "Pin thread"}
							shortcut={pinShortcut}
							onClick={() => {
								setOpen(false)
								togglePin(sessionId)
							}}
						/>
						<MenuItem
							icon={<Pencil className="h-3.5 w-3.5" />}
							label="Rename thread"
							shortcut={renameShortcut}
							onClick={() => {
								setOpen(false)
								onStartRename()
							}}
						/>
						<MenuItem
							icon={<Archive className="h-3.5 w-3.5" />}
							label="Archive thread"
							shortcut={archiveShortcut}
							onClick={() => {
								setOpen(false)
								onArchive()
							}}
						/>

						<div className="my-1.5 h-px bg-border/60" />

						<MenuItem
							icon={<Copy className="h-3.5 w-3.5" />}
							label="Copy working directory"
							shortcut={copyDirShortcut}
							onClick={() => copyToClipboard(directory, "Directory")}
						/>
						<MenuItem
							icon={<Copy className="h-3.5 w-3.5" />}
							label="Copy session ID"
							shortcut={copyIdShortcut}
							onClick={() => copyToClipboard(sessionId, "Session ID")}
						/>
					</div>,
					document.body,
				)}
		</>
	)
}

function MenuItem({
	icon,
	label,
	shortcut,
	onClick,
}: {
	icon: ReactNode
	label: string
	shortcut?: string
	onClick: () => void
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="el-surface-hover flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-foreground/85 transition-colors"
		>
			<span className="shrink-0 text-muted">{icon}</span>
			<span className="flex-1">{label}</span>
			{shortcut && (
				<span className="shrink-0 text-xs tracking-wide text-muted/50">{shortcut}</span>
			)}
		</button>
	)
}
