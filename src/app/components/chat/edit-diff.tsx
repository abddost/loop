import type { EditPart } from "@core/schema"
import { ChevronRight } from "@openai/apps-sdk-ui/components/Icon"
import { useEffect, useMemo, useState } from "react"
import { apiClient } from "../../lib/api-client"
import { cn } from "../ui/cn"
import { FileReference } from "./file-reference"
import { DiffBlock } from "./tool-output"

/** Matches the server's `FileDiffContent` shape from snapshot.diffFull(). */
interface FileDiffContent {
	path: string
	diff: string
	additions: number
	deletions: number
	status: "added" | "deleted" | "modified"
	binary: boolean
}

export interface EditDiffProps {
	sessionId: string
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

/**
 * Fetch the session-wide unified diff. Refetches whenever the latest edit hash
 * changes — during streaming, new EditParts advance the hash and the view
 * stays in sync. Returns loading/error alongside the data so UI can show
 * skeletons or fall back to stats-only rendering.
 */
function useSessionDiff(sessionId: string, fetchKey: string | undefined) {
	const [data, setData] = useState<FileDiffContent[] | null>(null)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (!sessionId || !fetchKey) {
			setData(null)
			return
		}
		let cancelled = false
		setLoading(true)
		setError(null)
		apiClient
			.get<FileDiffContent[]>(`/sessions/${sessionId}/diff`)
			.then((result) => {
				if (cancelled) return
				setData(result)
			})
			.catch((err) => {
				if (cancelled) return
				setError(err instanceof Error ? err.message : String(err))
			})
			.finally(() => {
				if (!cancelled) setLoading(false)
			})
		return () => {
			cancelled = true
		}
	}, [sessionId, fetchKey])

	return { data, loading, error }
}

function FileEntry({
	file,
	diff,
	diffLoading,
}: {
	file: NormalizedFile
	diff: FileDiffContent | undefined
	diffLoading: boolean
}) {
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
			{expanded && (
				<div className="border-t border-border/30 bg-background/40">
					{diff ? (
						diff.binary ? (
							<div className="px-3.5 py-4 text-xs text-muted-foreground">
								Binary file — diff not shown
							</div>
						) : diff.diff ? (
							<DiffBlock diff={diff.diff} filePath={file.path} />
						) : (
							<div className="px-3.5 py-4 text-xs text-muted-foreground">No textual changes</div>
						)
					) : diffLoading ? (
						<div className="flex items-center justify-center px-3.5 py-6">
							<div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted/30 border-t-accent" />
						</div>
					) : (
						<div className="px-3.5 py-4 text-xs text-muted-foreground">
							Diff unavailable for this edit
						</div>
					)}
				</div>
			)}
		</div>
	)
}

/**
 * Accumulated file change card shown at the bottom of the chat.
 * Displays "N files changed" with per-file stats, lazy-fetches the
 * session-wide unified diff on mount, and renders per-file diff on expand.
 */
export function EditDiff({ sessionId, parts, className }: EditDiffProps) {
	const files = accumulateFiles(parts)
	const totalAdd = files.reduce((s, f) => s + f.additions, 0)
	const totalDel = files.reduce((s, f) => s + f.deletions, 0)
	const latestHash = parts[parts.length - 1]?.hash

	const { data: sessionDiff, loading: diffLoading } = useSessionDiff(sessionId, latestHash)
	const diffByPath = useMemo(() => {
		const m = new Map<string, FileDiffContent>()
		if (sessionDiff) for (const d of sessionDiff) m.set(d.path, d)
		return m
	}, [sessionDiff])

	if (files.length === 0) return null

	return (
		<div
			className={cn("rounded-xl border border-border/60 bg-surface/40 backdrop-blur-sm", className)}
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
				{/* {onUndo && latestHash && (
					<button
						type="button"
						className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
						onClick={() => onUndo(latestHash)}
					>
						Undo {"\u21BA"}
					</button>
				)} */}
			</div>

			{/* File list */}
			<div className="border-t border-border/40">
				{files.map((file) => (
					<FileEntry
						key={file.path}
						file={file}
						diff={diffByPath.get(file.path)}
						diffLoading={diffLoading}
					/>
				))}
			</div>
		</div>
	)
}
