import { ChevronDown, Collapse, Expand, Undo } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useMemo } from "react"
import {
	type DiffStyle,
	type GitChange,
	selectChanges,
	selectFileDiff,
	selectIsChangeExpanded,
	useFilePanelStore,
} from "../../stores/file-panel-store"
import { FileIcon } from "../chat/file-icon"
import { DiffBlock } from "../chat/tool-output"
import { cn } from "../ui/cn"
import { Tooltip } from "../ui/tooltip"
import { DiffChanges } from "./diff-changes"
import { DiscardModal } from "./discard-modal"

/** Matches opencode's MAX_DIFF_CHANGED_LINES — files above this need explicit opt-in to render. */
const MAX_DIFF_CHANGED_LINES = 500

// Kept around so future status-badge variants can read off the same map
// without re-deriving the colour/label pairing. Currently the change rows
// surface status implicitly via the diff stats, but `git status` letter
// badges are likely to come back behind a setting.
export const statusColors: Record<GitChange["status"], string> = {
	new: "text-diff-add",
	modified: "text-warning",
	deleted: "text-diff-remove",
	renamed: "text-accent",
	untracked: "text-muted",
}

export const statusLabels: Record<GitChange["status"], string> = {
	new: "N",
	modified: "M",
	deleted: "D",
	renamed: "R",
	untracked: "U",
}

export function ReviewPanel() {
	const changes = useFilePanelStore(selectChanges)
	const gitError = useFilePanelStore((s) => s.gitError)
	const clearGitError = useFilePanelStore((s) => s.clearGitError)
	const diffStyle = useFilePanelStore((s) => s.diffStyle)
	const setDiffStyle = useFilePanelStore((s) => s.setDiffStyle)
	const setChangeExpanded = useFilePanelStore((s) => s.setChangeExpanded)
	const expandedMap = useFilePanelStore((s) =>
		s.activeDir ? s.expandedChangesByDir[s.activeDir] : undefined,
	)

	const totals = useMemo(() => {
		let adds = 0
		let dels = 0
		for (const c of changes) {
			adds += c.additions
			dels += c.deletions
		}
		return { adds, dels }
	}, [changes])

	const anyExpanded = useMemo(() => {
		if (!expandedMap) return false
		return changes.some((c) => expandedMap[c.path])
	}, [changes, expandedMap])

	const handleToggleAll = useCallback(() => {
		const next = !anyExpanded
		for (const change of changes) {
			setChangeExpanded(change.path, next)
		}
	}, [anyExpanded, changes, setChangeExpanded])

	if (changes.length === 0) {
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
			<ReviewToolbar
				changeCount={changes.length}
				additions={totals.adds}
				deletions={totals.dels}
				anyExpanded={anyExpanded}
				onToggleAll={handleToggleAll}
				diffStyle={diffStyle}
				onDiffStyleChange={setDiffStyle}
			/>

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

			<div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
				{changes.map((change) => (
					<ChangeRow key={change.path} change={change} />
				))}
			</div>

			<DiscardModal />
		</div>
	)
}

function ReviewToolbar({
	changeCount,
	additions,
	deletions,
	anyExpanded,
	onToggleAll,
	diffStyle,
	onDiffStyleChange,
}: {
	changeCount: number
	additions: number
	deletions: number
	anyExpanded: boolean
	onToggleAll: () => void
	diffStyle: DiffStyle
	onDiffStyleChange: (style: DiffStyle) => void
}) {
	return (
		<div className="flex items-center justify-between border-b border-[var(--separator)] bg-background px-3 py-2.5">
			<div className="flex items-center gap-2 text-sm text-muted">
				<span className="font-medium text-foreground">
					{changeCount} {changeCount === 1 ? "Change" : "Changes"}
				</span>
				{(additions > 0 || deletions > 0) && (
					<DiffChanges additions={additions} deletions={deletions} />
				)}
			</div>

			<div className="flex items-center gap-1">
				<Tooltip content={anyExpanded ? "Collapse all" : "Expand all"}>
					<button
						type="button"
						onClick={onToggleAll}
						className="el-surface-hover flex h-6 w-6 items-center justify-center text-muted hover:text-foreground"
					>
						{anyExpanded ? (
							<Collapse className="h-3 w-3" aria-hidden="true" />
						) : (
							<Expand className="h-3 w-3" aria-hidden="true" />
						)}
					</button>
				</Tooltip>
				<DiffStyleToggle value={diffStyle} onChange={onDiffStyleChange} />
			</div>
		</div>
	)
}

function DiffStyleToggle({
	value,
	onChange,
}: {
	value: DiffStyle
	onChange: (style: DiffStyle) => void
}) {
	return (
		<div className="flex items-center rounded-md bg-surface-hover/60 p-0.5">
			{(["unified", "split"] as const).map((style) => (
				<button
					key={style}
					type="button"
					onClick={() => onChange(style)}
					className={cn(
						"rounded px-2 py-0.5 text-[10px] font-medium capitalize transition-colors",
						value === style
							? "bg-background text-foreground shadow-[var(--shadow-inset)]"
							: "text-muted hover:text-foreground",
					)}
				>
					{style}
				</button>
			))}
		</div>
	)
}

function ChangeRow({ change }: { change: GitChange }) {
	const isExpanded = useFilePanelStore((s) => selectIsChangeExpanded(s, change.path))
	const diff = useFilePanelStore((s) => selectFileDiff(s, change.path))
	const forceLarge = useFilePanelStore((s) => !!s.forceLargeDiff[change.path])
	const toggleChangeExpanded = useFilePanelStore((s) => s.toggleChangeExpanded)
	const requestDiscard = useFilePanelStore((s) => s.requestDiscard)
	const forceRenderLargeDiff = useFilePanelStore((s) => s.forceRenderLargeDiff)

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

	const parts = change.path.split("/")
	const fileName = parts[parts.length - 1]
	const dirPath = parts.length > 1 ? parts.slice(0, -1).join("/") : ""
	const changedLines = change.additions + change.deletions
	const tooLarge = isExpanded && !forceLarge && changedLines > MAX_DIFF_CHANGED_LINES

	return (
		<div className="mb-0.5 overflow-hidden rounded-lg transition-colors">
			<button
				type="button"
				onClick={handleToggle}
				className={cn(
					"el-surface-hover group flex w-full cursor-pointer items-center gap-2.5 px-2.5 py-2 text-left transition-all",
					isExpanded && "bg-[var(--app-surface-hover)]",
				)}
			>
				<ChevronDown
					className={cn(
						"h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-200",
						!isExpanded && "-rotate-90",
					)}
				/>
				<FileIcon filePath={change.path} size={16} />
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<span className="truncate text-sm font-medium text-foreground">{fileName}</span>
					{dirPath && <span className="truncate text-xs text-muted/60">{dirPath}</span>}
				</div>
				<DiffChanges additions={change.additions} deletions={change.deletions} />
				<Tooltip content="Discard changes">
					<button
						type="button"
						onClick={handleRevert}
						className="flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 transition-all hover:bg-danger/15 hover:text-danger group-hover:opacity-100"
					>
						<Undo className="h-3.5 w-3.5" />
					</button>
				</Tooltip>
			</button>

			{isExpanded && (
				<div className="border-t border-[var(--separator)]">
					{tooLarge ? (
						<LargeDiffGuard
							changedLines={changedLines}
							onRender={() => forceRenderLargeDiff(change.path)}
						/>
					) : diff ? (
						<DiffBlock diff={diff.diff} filePath={change.path} />
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

function LargeDiffGuard({
	changedLines,
	onRender,
}: {
	changedLines: number
	onRender: () => void
}) {
	return (
		<div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
			<p className="text-xs font-medium text-foreground">This diff is large</p>
			<p className="text-[10px] text-muted">
				{changedLines.toLocaleString()} changed lines (limit{" "}
				{MAX_DIFF_CHANGED_LINES.toLocaleString()})
			</p>
			<button
				type="button"
				onClick={onRender}
				className="el-btn-pill bg-surface-hover px-3 py-1 text-[11px] font-medium text-foreground hover:bg-surface-hover/80"
			>
				Render anyway
			</button>
		</div>
	)
}
