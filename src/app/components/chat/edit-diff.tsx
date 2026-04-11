import type { EditPart } from "@core/schema"
import { ChevronRight } from "@openai/apps-sdk-ui/components/Icon"
import { useState } from "react"
import { cn } from "../ui/cn"
import { FileReference } from "./file-reference"

export interface EditDiffProps {
	parts: EditPart[]
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

type NormalizedFile = ReturnType<typeof normalizeFile>

/** Accumulate files from multiple edit parts, keeping latest per path. */
function accumulateFiles(parts: EditPart[]): NormalizedFile[] {
	const map = new Map<string, NormalizedFile>()
	for (const part of parts) {
		for (const file of part.files) {
			const normalized = normalizeFile(file)
			map.set(normalized.path, normalized)
		}
	}
	return Array.from(map.values())
}

function basename(path: string): string {
	return path.split("/").pop() ?? path
}

function FileEntry({ file }: { file: NormalizedFile }) {
	const [expanded, setExpanded] = useState(false)
	const name = basename(file.path)

	return (
		<div className="border-b border-border/30 last:border-b-0">
			<button
				type="button"
				className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm transition-colors hover:bg-surface-hover/40"
				onClick={() => setExpanded(!expanded)}
				aria-expanded={expanded}
			>
				<span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
					<FileReference path={file.path} display={name} className="text-foreground" />
				</span>
				{(file.additions > 0 || file.deletions > 0) && (
					<span className="flex items-center gap-1.5 text-xs tabular-nums">
						{file.additions > 0 && <span className="text-success">+{file.additions}</span>}
						{file.deletions > 0 && <span className="text-error">&minus;{file.deletions}</span>}
					</span>
				)}
				<ChevronRight
					className={cn(
						"h-3 w-3 shrink-0 text-muted transition-transform duration-200",
						expanded && "rotate-90",
					)}
					aria-hidden="true"
				/>
			</button>
		</div>
	)
}

/**
 * Accumulated file change card shown at the bottom of the chat.
 * Displays "N files changed" with per-file stats and undo.
 */
export function EditDiff({ parts, onUndo, className }: EditDiffProps) {
	const files = accumulateFiles(parts)
	const totalAdd = files.reduce((s, f) => s + f.additions, 0)
	const totalDel = files.reduce((s, f) => s + f.deletions, 0)
	const latestHash = parts[parts.length - 1]?.hash

	if (files.length === 0) return null

	return (
		<div
			className={cn(
				"rounded-xl bg-surface/40 backdrop-blur-sm shadow-[var(--shadow-inset)]",
				className,
			)}
		>
			{/* Header */}
			<div className="flex items-center justify-between px-3.5 py-2.5">
				<span className="text-sm text-foreground font-medium">
					{files.length} file{files.length !== 1 ? "s" : ""} changed
					{(totalAdd > 0 || totalDel > 0) && (
						<>
							{" "}
							{totalAdd > 0 && <span className="text-success font-normal">+{totalAdd}</span>}
							{totalDel > 0 && (
								<span className="ml-1 text-error font-normal">&minus;{totalDel}</span>
							)}
						</>
					)}
				</span>
				{onUndo && latestHash && (
					<button
						type="button"
						className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
						onClick={() => onUndo(latestHash)}
					>
						Undo {"\u21BA"}
					</button>
				)}
			</div>

			{/* File list */}
			<div className="border-t border-[var(--separator)]">
				{files.map((file) => (
					<FileEntry key={file.path} file={file} />
				))}
			</div>
		</div>
	)
}
