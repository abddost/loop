import { useEffect } from "react"

interface UnsavedChangesModalProps {
	fileName: string
	onSave: () => void | Promise<void>
	onDiscard: () => void
	onCancel: () => void
}

export function UnsavedChangesModal({
	fileName,
	onSave,
	onDiscard,
	onCancel,
}: UnsavedChangesModalProps) {
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault()
				onCancel()
			}
		}
		document.addEventListener("keydown", handler)
		return () => document.removeEventListener("keydown", handler)
	}, [onCancel])

	return (
		<div
			className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onCancel()
			}}
		>
			<div className="w-[420px] max-w-[90vw] overflow-hidden rounded-lg border border-border bg-overlay p-4 shadow-[var(--shadow-dropdown)]">
				<h2 className="text-sm font-medium text-foreground">Save changes?</h2>
				<p className="mt-2 text-xs text-muted">
					<span className="text-foreground">{fileName}</span> has unsaved changes. Save them before
					closing?
				</p>
				<div className="mt-4 flex justify-end gap-2">
					<button
						type="button"
						onClick={onCancel}
						className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-muted hover:bg-surface-hover hover:text-foreground"
					>
						Cancel
					</button>
					<button
						type="button"
						onClick={onDiscard}
						className="cursor-pointer rounded-md px-3 py-1.5 text-xs text-error hover:bg-error/10"
					>
						Discard
					</button>
					<button
						type="button"
						onClick={() => {
							void onSave()
						}}
						className="cursor-pointer rounded-md bg-accent px-3 py-1.5 text-xs text-accent-foreground hover:opacity-90"
					>
						Save
					</button>
				</div>
			</div>
		</div>
	)
}
