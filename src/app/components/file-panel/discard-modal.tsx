import { useCallback, useEffect } from "react"
import { useFilePanelStore } from "../../stores/file-panel-store"
import { cn } from "../ui/cn"

export function DiscardModal() {
	const target = useFilePanelStore((s) => s.discardTarget)
	const cancelDiscard = useFilePanelStore((s) => s.cancelDiscard)
	const confirmDiscard = useFilePanelStore((s) => s.confirmDiscard)
	const loading = useFilePanelStore((s) => s.gitOperationLoading)

	// Escape key handler
	useEffect(() => {
		if (!target) return
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") cancelDiscard()
		}
		document.addEventListener("keydown", handler)
		return () => document.removeEventListener("keydown", handler)
	}, [target, cancelDiscard])

	const handleConfirm = useCallback(() => {
		confirmDiscard()
	}, [confirmDiscard])

	if (!target) return null

	const fileName = target.path.split("/").pop() ?? target.path
	const isTracked = target.status !== "untracked"

	return (
		<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
			<div
				className={cn(
					"w-[400px] rounded-2xl border border-border/60 bg-overlay p-5 shadow-2xl",
					"animate-in fade-in zoom-in-95 duration-200",
				)}
			>
				<h3 className="text-sm font-semibold text-foreground">Discard Changes?</h3>
				<p className="mt-2 text-xs leading-relaxed text-muted">
					This will revert all changes to{" "}
					<span className="font-medium text-foreground">&quot;{fileName}&quot;</span>.{" "}
					{isTracked
						? "The file will be restored to its last committed state."
						: "The untracked file will be permanently deleted."}
				</p>
				<p className="mt-1.5 text-[10px] text-danger/70">This action cannot be undone.</p>

				<div className="mt-4 flex items-center justify-end gap-2">
					<button
						type="button"
						onClick={cancelDiscard}
						className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground"
					>
						Cancel
						<kbd className="ml-1 rounded bg-surface-hover px-1 py-0.5 text-[9px] font-medium text-muted">
							Esc
						</kbd>
					</button>
					<button
						type="button"
						onClick={handleConfirm}
						disabled={loading}
						className={cn(
							"flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-medium transition-all",
							"bg-danger text-danger-foreground hover:bg-danger/90 active:scale-[0.98]",
							loading && "cursor-not-allowed opacity-60",
						)}
					>
						{loading ? (
							<div className="h-3 w-3 animate-spin rounded-full border-2 border-current/30 border-t-current" />
						) : (
							<svg
								className="h-3 w-3"
								viewBox="0 0 16 16"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								aria-hidden="true"
							>
								<path
									d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</svg>
						)}
						Discard
					</button>
				</div>
			</div>
		</div>
	)
}
