import { ChevronDown, Undo } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useMemo } from "react"
import { type DiffLine, parseDiff } from "../../lib/diff"
import {
	type FileDiff,
	type GitChange,
	selectChanges,
	selectFileDiff,
	selectIsChangeExpanded,
	useFilePanelStore,
} from "../../stores/file-panel-store"
import { FileIcon } from "../chat/file-icon"
import { cn } from "../ui/cn"
import { Tooltip } from "../ui/tooltip"
import { DiscardModal } from "./discard-modal"
import { GitActionsBar } from "./git-actions-bar"

export function GitChangesTab() {
	const allChanges = useFilePanelStore(selectChanges)
	const changeFilter = useFilePanelStore((s) => s.changeFilter)
	const gitError = useFilePanelStore((s) => s.gitError)
	const clearGitError = useFilePanelStore((s) => s.clearGitError)

	const filteredChanges = useMemo(() => {
		if (changeFilter === "all") return allChanges
		if (changeFilter === "staged") return allChanges.filter((c) => c.staged)
		return allChanges.filter((c) => !c.staged)
	}, [allChanges, changeFilter])

	if (allChanges.length === 0) {
		return (
			<div className="flex h-full flex-col">
				<div className="flex flex-1 items-center justify-center">
					<div className="text-center">
						<div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-surface-hover/60">
							<svg
								className="h-5 w-5 text-muted/60"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								aria-hidden="true"
							>
								<path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
								<circle cx="12" cy="12" r="10" />
							</svg>
						</div>
						<p className="text-xs text-muted/70">No uncommitted changes</p>
					</div>
				</div>
			</div>
		)
	}

	return (
		<div className="flex h-full flex-col">
			{/* Git actions bar */}
			<GitActionsBar />

			{/* Error banner */}
			{gitError && (
				<div className="mx-2 mt-1 flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
					<span className="flex-1 truncate">{gitError}</span>
					<button
						type="button"
						onClick={clearGitError}
						className="shrink-0 text-danger/60 transition-colors hover:text-danger"
					>
						&times;
					</button>
				</div>
			)}

			{/* Change list */}
			<div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
				{filteredChanges.length === 0 ? (
					<div className="flex items-center justify-center py-8 text-xs text-muted/60">
						No changes in this filter
					</div>
				) : (
					filteredChanges.map((change, i) => (
						<ChangeRow key={change.path} change={change} index={i} />
					))
				)}
			</div>

			{/* Discard confirmation modal */}
			<DiscardModal />
		</div>
	)
}

const statusColors: Record<GitChange["status"], string> = {
	new: "text-success",
	modified: "text-warning",
	deleted: "text-danger",
	renamed: "text-accent",
	untracked: "text-muted",
}

const statusLabels: Record<GitChange["status"], string> = {
	new: "N",
	modified: "M",
	deleted: "D",
	renamed: "R",
	untracked: "U",
}

function ChangeRow({ change, index }: { change: GitChange; index: number }) {
	const isExpanded = useFilePanelStore((s) => selectIsChangeExpanded(s, change.path))
	const diff = useFilePanelStore((s) => selectFileDiff(s, change.path))
	const toggleChangeExpanded = useFilePanelStore((s) => s.toggleChangeExpanded)
	const requestDiscard = useFilePanelStore((s) => s.requestDiscard)

	const handleToggle = useCallback(() => {
		toggleChangeExpanded(change.path)
	}, [toggleChangeExpanded, change.path])

	const handleRevert = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			requestDiscard(change)
		},
		[requestDiscard, change],
	)

	// Extract filename from path
	const parts = change.path.split("/")
	const fileName = parts[parts.length - 1]
	const dirPath = parts.length > 1 ? parts.slice(0, -1).join("/") : ""

	return (
		<div
			className="mb-0.5 overflow-hidden rounded-lg transition-colors"
			style={{ animationDelay: `${index * 20}ms` }}
		>
			{/* File header row */}
			<button
				type="button"
				onClick={handleToggle}
				className={cn(
					"group flex w-full cursor-pointer items-center gap-2 px-2 py-1.5 text-left transition-all",
					isExpanded ? "bg-surface-hover/80" : "hover:bg-surface-hover/50",
				)}
			>
				<ChevronDown
					className={cn(
						"h-3 w-3 shrink-0 text-muted transition-transform duration-200",
						!isExpanded && "-rotate-90",
					)}
				/>
				<FileIcon filePath={change.path} size={14} />
				<div className="flex min-w-0 flex-1 items-center gap-1.5">
					<span className="truncate text-xs font-medium text-foreground">{fileName}</span>
					{dirPath && <span className="truncate text-[10px] text-muted/60">{dirPath}</span>}
				</div>
				{/* Diff stats */}
				{(change.additions > 0 || change.deletions > 0) && (
					<span className="flex items-center gap-1 text-[10px] font-mono tabular-nums">
						{change.additions > 0 && <span className="text-diff-add">+{change.additions}</span>}
						{change.deletions > 0 && <span className="text-diff-remove">-{change.deletions}</span>}
					</span>
				)}
				{/* Status badge */}
				<span
					className={cn(
						"flex h-4 w-4 shrink-0 items-center justify-center rounded text-[10px] font-bold",
						statusColors[change.status],
					)}
				>
					{statusLabels[change.status]}
				</span>
				{/* Revert button */}
				<Tooltip content="Discard changes">
					<button
						type="button"
						onClick={handleRevert}
						className="flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 transition-all hover:bg-danger/15 hover:text-danger group-hover:opacity-100"
					>
						<Undo className="h-3 w-3" />
					</button>
				</Tooltip>
			</button>

			{/* Inline diff */}
			{isExpanded && (
				<div className="border-t border-border/30">
					{diff ? (
						<InlineDiff diff={diff} />
					) : (
						<div className="flex items-center justify-center py-6">
							<div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted/30 border-t-accent" />
						</div>
					)}
				</div>
			)}
		</div>
	)
}

// ─── Inline diff renderer ────────────────────────────────────────

function InlineDiff({ diff }: { diff: FileDiff }) {
	const lines = useMemo(() => parseDiff(diff.diff), [diff.diff])

	const gutterWidth = useMemo(() => {
		let max = 0
		for (const line of lines) {
			if (line.oldLineNo != null && line.oldLineNo > max) max = line.oldLineNo
			if (line.newLineNo != null && line.newLineNo > max) max = line.newLineNo
		}
		return `${Math.max(String(max).length + 1, 3)}ch`
	}, [lines])

	const groups = useMemo(() => groupByHunks(lines), [lines])

	if (lines.length === 0) {
		return (
			<div className="flex items-center justify-center py-4 text-xs text-muted/60">
				No diff available
			</div>
		)
	}

	return (
		<pre
			className={cn(
				"overflow-auto text-[11px] font-mono leading-[18px]",
				"[&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5",
				"[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/50",
			)}
		>
			<code>
				{groups.map((group, gi) => {
					const key =
						group.type === "hunk" ? `hunk-${gi}-${group.hunkHeader ?? ""}` : `changes-${gi}`
					return <DiffGroup key={key} group={group} gutterWidth={gutterWidth} />
				})}
			</code>
		</pre>
	)
}

// ─── Hunk grouping ───────────────────────────────────────────────

interface HunkGroup {
	type: "hunk" | "changes"
	hunkHeader?: string
	lines: DiffLine[]
}

function groupByHunks(lines: DiffLine[]): HunkGroup[] {
	const groups: HunkGroup[] = []
	let current: HunkGroup | null = null

	for (const line of lines) {
		if (line.type === "hunk") {
			if (current) groups.push(current)
			groups.push({ type: "hunk", hunkHeader: line.hunkHeader, lines: [] })
			current = { type: "changes", lines: [] }
		} else {
			if (!current) current = { type: "changes", lines: [] }
			current.lines.push(line)
		}
	}
	if (current && current.lines.length > 0) groups.push(current)

	return groups
}

function DiffGroup({ group, gutterWidth }: { group: HunkGroup; gutterWidth: string }) {
	if (group.type === "hunk") {
		return (
			<div className="bg-diff-hunk-bg px-3 py-0.5 text-accent/50 select-none text-[10px]">
				{group.hunkHeader ? `@@ ${group.hunkHeader}` : "···"}
			</div>
		)
	}

	return (
		<>
			{group.lines.map((line) => {
				const key = `${line.type}-${line.oldLineNo ?? ""}-${line.newLineNo ?? ""}`
				return <DiffLineRow key={key} line={line} gutterWidth={gutterWidth} />
			})}
		</>
	)
}

function DiffLineRow({ line, gutterWidth }: { line: DiffLine; gutterWidth: string }) {
	return (
		<div
			className={cn(
				"flex",
				line.type === "add" && "bg-diff-add-bg text-diff-add",
				line.type === "remove" && "bg-diff-remove-bg text-diff-remove",
				line.type === "context" && "text-muted-foreground/70",
			)}
		>
			<span
				className="shrink-0 select-none text-right text-muted-foreground/25 pr-1"
				style={{ width: gutterWidth }}
			>
				{line.oldLineNo ?? ""}
			</span>
			<span
				className="shrink-0 select-none text-right text-muted-foreground/25 pr-2"
				style={{ width: gutterWidth }}
			>
				{line.newLineNo ?? ""}
			</span>
			<span className="shrink-0 w-[1ch] select-none text-center">
				{line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}
			</span>
			<span className="flex-1 whitespace-pre">{line.content}</span>
		</div>
	)
}
