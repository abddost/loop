import type { EditPart } from "@core/schema"
import { useState } from "react"
import { Button } from "../ui/button"
import { cn } from "../ui/cn"
import { FileReference } from "./file-reference"

export interface EditDiffProps {
	part: EditPart
	onUndo?: (hash: string) => void
	className?: string
}

/** Normalize a file entry to always have path + stats. */
function normalizeFile(
	file: string | { path: string; additions?: number; deletions?: number; status?: string },
) {
	if (typeof file === "string")
		return { path: file, additions: 0, deletions: 0, status: "modified" as const }
	return {
		path: file.path,
		additions: file.additions ?? 0,
		deletions: file.deletions ?? 0,
		status: (file.status ?? "modified") as "added" | "deleted" | "modified",
	}
}

const COLLAPSED_LIMIT = 10

/**
 * File change card: "N files changed +X -Y" with per-file stats and undo.
 */
export function EditDiff({ part, onUndo, className }: EditDiffProps) {
	const files = part.files.map(normalizeFile)
	const totalAdd = part.totalAdditions ?? files.reduce((s, f) => s + f.additions, 0)
	const totalDel = part.totalDeletions ?? files.reduce((s, f) => s + f.deletions, 0)
	const [expanded, setExpanded] = useState(false)
	const visibleFiles = expanded ? files : files.slice(0, COLLAPSED_LIMIT)
	const hiddenCount = files.length - COLLAPSED_LIMIT

	return (
		<div className={cn("rounded-[--radius-md] border border-border", className)}>
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-2">
				<span className="text-sm text-foreground">
					{files.length} file{files.length !== 1 ? "s" : ""} changed
					{(totalAdd > 0 || totalDel > 0) && (
						<>
							{" "}
							{totalAdd > 0 && <span className="text-emerald-400">+{totalAdd}</span>}
							{totalDel > 0 && <span className="ml-1 text-red-400">-{totalDel}</span>}
						</>
					)}
				</span>
				{onUndo && (
					<Button variant="ghost" size="sm" onClick={() => onUndo(part.hash)}>
						Undo {"\u21BA"}
					</Button>
				)}
			</div>

			{/* File list */}
			<ul className="border-t border-border">
				{visibleFiles.map((file) => (
					<li
						key={file.path}
						className="flex items-center gap-2 border-b border-border/50 px-3 py-1.5 last:border-b-0"
					>
						<span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
							<FileReference path={file.path} />
						</span>
						{(file.additions > 0 || file.deletions > 0) && (
							<span className="shrink-0 text-xs">
								{file.additions > 0 && <span className="text-emerald-400">+{file.additions}</span>}
								{file.deletions > 0 && <span className="ml-1 text-red-400">-{file.deletions}</span>}
							</span>
						)}
						<span
							className={cn(
								"size-1.5 shrink-0 rounded-full",
								file.status === "added" && "bg-emerald-400",
								file.status === "deleted" && "bg-red-400",
								file.status === "modified" && "bg-blue-400",
							)}
						/>
					</li>
				))}
			</ul>

			{/* Expand toggle */}
			{hiddenCount > 0 && !expanded && (
				<button
					type="button"
					className="w-full border-t border-border/50 px-3 py-1.5 text-xs text-muted hover:text-foreground"
					onClick={() => setExpanded(true)}
				>
					Show {hiddenCount} more file{hiddenCount !== 1 ? "s" : ""}
				</button>
			)}
		</div>
	)
}
