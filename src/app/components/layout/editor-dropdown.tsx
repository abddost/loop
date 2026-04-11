import { Check, ChevronDown, Copy, ExternalLink } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { getDefaultEditor, openDirectoryInEditor } from "../../lib/editor"
import { useConfigStore } from "../../stores/config-store"
import { useEditorStore } from "../../stores/editor-store"
import { useUIStore } from "../../stores/ui-store"
import { EditorIcon } from "../icons/editor-icons"
import { cn } from "../ui/cn"

/**
 * "Open in" dropdown button for the content titlebar.
 * Lists detected editors, sets default on selection, and opens the workspace directory.
 */
export function EditorDropdown() {
	const [open, setOpen] = useState(false)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)

	const editors = useEditorStore((s) => s.editors)
	const defaultEditor = useConfigStore((s) => s.config.defaultEditor)
	const available = editors.filter((e) => e.available)

	const effectiveEditor = getDefaultEditor()

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

	const handleSelect = useCallback(
		async (editorId: string) => {
			setOpen(false)
			// Persist as default
			if (editorId !== defaultEditor) {
				useConfigStore.getState().update({ defaultEditor: editorId })
			}
			// Open workspace directory in the editor
			await openDirectoryInEditor(editorId)
		},
		[defaultEditor],
	)

	const handleCopyPath = useCallback(() => {
		setOpen(false)
		const dir = useUIStore.getState().activeDirectory
		if (dir) {
			navigator.clipboard.writeText(dir).catch(() => {})
		}
	}, [])

	// Calculate panel position
	const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({})
	useEffect(() => {
		if (!open || !triggerRef.current) return
		const rect = triggerRef.current.getBoundingClientRect()
		setPanelStyle({
			position: "fixed",
			top: rect.bottom + 4,
			right: Math.max(window.innerWidth - rect.right, 8),
			minWidth: 180,
			zIndex: 50,
		})
	}, [open])

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => setOpen(!open)}
				className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-foreground transition-colors hover:bg-surface-hover"
			>
				{effectiveEditor ? (
					<EditorIcon id={effectiveEditor} width={22} height={22} className="shrink-0" />
				) : (
					<ExternalLink className="w-3 h-3" aria-hidden="true" />
				)}
				<span>Open</span>
				<ChevronDown
					className={cn(
						"w-2.5 h-2.5 ml-0.5 text-muted transition-transform duration-150",
						open && "rotate-180",
					)}
					aria-hidden="true"
				/>
			</button>

			{open &&
				createPortal(
					<div ref={panelRef} style={panelStyle} className="el-dropdown rounded-xl">
						{/* Header */}
						<div className="border-b border-[var(--separator)] px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted">
							Open in
						</div>

						{/* Editor list */}
						<div className="py-1">
							{available.map((editor) => (
								<button
									key={editor.id}
									type="button"
									onClick={() => handleSelect(editor.id)}
									className={cn(
										"flex w-full items-center justify-between px-3 py-1.5 text-left text-sm transition-colors",
										"el-surface-hover text-foreground/80",
									)}
								>
									<span className="flex items-center gap-2">
										<EditorIcon id={editor.id} width={22} height={22} className="shrink-0" />
										{editor.name}
									</span>
									{editor.id === effectiveEditor && (
										<Check className="w-3.5 h-3.5 shrink-0 text-accent" aria-hidden="true" />
									)}
								</button>
							))}
						</div>

						{/* Copy path */}
						<div className="border-t border-[var(--separator)] py-1">
							<button
								type="button"
								onClick={handleCopyPath}
								className="el-surface-hover flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground/80 transition-colors"
							>
								<Copy className="w-3.5 h-3.5 shrink-0 text-muted" aria-hidden="true" />
								<span>Copy path</span>
							</button>
						</div>
					</div>,
					document.body,
				)}
		</>
	)
}
