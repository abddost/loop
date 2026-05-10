import { selectOpenFiles, useFilePanelStore } from "../../stores/file-panel-store"

interface ConflictBannerProps {
	uri: string
}

export function ConflictBanner({ uri }: ConflictBannerProps) {
	const file = useFilePanelStore((s) => selectOpenFiles(s).find((f) => f.uri === uri))
	const acceptDiskChanges = useFilePanelStore((s) => s.acceptDiskChanges)
	const saveFile = useFilePanelStore((s) => s.saveFile)
	const dismissConflict = useFilePanelStore((s) => s.dismissConflict)

	if (!file?.diskConflict) return null

	return (
		<div className="flex shrink-0 items-center justify-between gap-3 border-b border-warning/40 bg-warning/10 px-3 py-2 text-[12px] text-foreground">
			<div className="flex flex-col">
				<span className="font-medium">File changed on disk</span>
				<span className="text-[11px] text-muted">
					This file was modified outside the editor while you have unsaved changes.
				</span>
			</div>
			<div className="flex shrink-0 items-center gap-1">
				<button
					type="button"
					onClick={() => acceptDiskChanges(uri)}
					className="cursor-pointer rounded px-2 py-1 text-[11px] hover:bg-foreground/10"
					title="Discard your edits and load the version from disk"
				>
					Use disk version
				</button>
				<button
					type="button"
					onClick={() => {
						saveFile(uri).catch((err) =>
							console.error("[conflict-banner] overwrite save failed:", err),
						)
					}}
					className="cursor-pointer rounded bg-warning/20 px-2 py-1 text-[11px] text-warning hover:bg-warning/30"
					title="Save your edits, overwriting the disk version"
				>
					Overwrite disk
				</button>
				<button
					type="button"
					onClick={() => dismissConflict(uri)}
					className="cursor-pointer rounded px-2 py-1 text-[11px] text-muted hover:bg-foreground/10"
					title="Dismiss notice (your edits remain unsaved)"
				>
					Dismiss
				</button>
			</div>
		</div>
	)
}
