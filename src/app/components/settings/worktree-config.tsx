import { Branch } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useEffect, useState } from "react"
import type { SandboxWithProject } from "../../lib/worktree-api"
import { worktreeApi } from "../../lib/worktree-api"
import { useConfigStore } from "../../stores/config-store"
import { cn } from "../ui/cn"
import { Spinner, ToggleSwitch } from "./shared"

const DEFAULT_LIMIT = 20

export function WorktreeConfig({ className }: { className?: string }) {
	const autoDeleteLimit = useConfigStore((s) => s.config.worktree?.autoDeleteLimit) ?? DEFAULT_LIMIT
	const [worktrees, setWorktrees] = useState<SandboxWithProject[]>([])
	const [loading, setLoading] = useState(true)
	const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

	const fetchWorktrees = useCallback(() => {
		worktreeApi
			.listAll()
			.then(setWorktrees)
			.catch((err) => console.error("[worktree-config] fetch failed", err))
			.finally(() => setLoading(false))
	}, [])

	useEffect(() => {
		fetchWorktrees()
	}, [fetchWorktrees])

	const handleLimitChange = useCallback((value: number) => {
		useConfigStore.getState().update({ worktree: { autoDeleteLimit: value } })
	}, [])

	const handleDelete = useCallback(async (sandboxId: string) => {
		setDeletingIds((prev) => new Set(prev).add(sandboxId))
		try {
			await worktreeApi.removeGlobal(sandboxId)
			setWorktrees((prev) => prev.filter((w) => w.id !== sandboxId))
		} catch (err) {
			console.error("[worktree-config] delete failed", err)
		} finally {
			setDeletingIds((prev) => {
				const next = new Set(prev)
				next.delete(sandboxId)
				return next
			})
		}
	}, [])

	// Group worktrees by project
	const grouped = new Map<string, { projectName: string; items: SandboxWithProject[] }>()
	for (const wt of worktrees) {
		const key = wt.projectDirectory
		const group = grouped.get(key)
		if (group) {
			group.items.push(wt)
		} else {
			grouped.set(key, { projectName: wt.projectName, items: [wt] })
		}
	}

	return (
		<div className={className}>
			<h1 className="mb-6 text-xl font-semibold text-foreground">Worktrees</h1>

			{/* Auto-delete settings card */}
			<div className="divide-y divide-border rounded-xl border border-border">
				<SettingRow
					label="Automatically delete old worktrees"
					description="Recommended for most users. Old worktrees beyond the limit are pruned when new ones are created."
				>
					<ToggleSwitch checked={true} onChange={() => {}} />
				</SettingRow>

				<SettingRow
					label="Auto-delete limit"
					description="Number of most recent worktrees to keep. Older ones are pruned automatically."
				>
					<LimitInput value={autoDeleteLimit} onChange={handleLimitChange} />
				</SettingRow>
			</div>

			{/* Worktree list */}
			<h2 className="mb-4 mt-10 text-[13px] font-semibold text-foreground">All worktrees</h2>

			{loading ? (
				<div className="flex items-center justify-center rounded-xl border border-border py-12">
					<Spinner />
				</div>
			) : worktrees.length === 0 ? (
				<div className="rounded-xl border border-border">
					<div className="px-5 py-10 text-center text-xs text-muted">No worktrees found.</div>
				</div>
			) : (
				<div className="space-y-6">
					{[...grouped.entries()].map(([projectDir, { projectName, items }]) => (
						<WorktreeGroup
							key={projectDir}
							projectName={projectName}
							projectDirectory={projectDir}
							worktrees={items}
							deletingIds={deletingIds}
							onDelete={handleDelete}
						/>
					))}
				</div>
			)}
		</div>
	)
}

// ────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────

function SettingRow({
	label,
	description,
	children,
}: {
	label: string
	description: string
	children: React.ReactNode
}) {
	return (
		<div className="flex items-center justify-between gap-6 px-5 py-4">
			<div className="min-w-0">
				<div className="text-sm font-medium text-foreground">{label}</div>
				<div className="mt-0.5 text-xs text-muted">{description}</div>
			</div>
			<div className="shrink-0">{children}</div>
		</div>
	)
}

function LimitInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
	return (
		<input
			type="number"
			value={value}
			min={1}
			max={100}
			onChange={(e) => {
				const n = Number(e.target.value)
				if (!Number.isNaN(n) && n >= 1 && n <= 100) onChange(n)
			}}
			className="w-16 rounded-lg border border-border bg-segment-bg px-2.5 py-1 text-center text-xs tabular-nums text-foreground outline-none focus:border-accent"
		/>
	)
}

function WorktreeGroup({
	projectName,
	projectDirectory,
	worktrees,
	deletingIds,
	onDelete,
}: {
	projectName: string
	projectDirectory: string
	worktrees: SandboxWithProject[]
	deletingIds: Set<string>
	onDelete: (id: string) => void
}) {
	return (
		<div>
			{/* Project header */}
			<div className="mb-1.5 flex items-center gap-2">
				<FolderIcon />
				<span className="text-[13px] font-medium text-foreground">{projectName}</span>
			</div>
			<p className="mb-3 break-all font-mono text-[11px] leading-relaxed text-muted">
				{projectDirectory}
			</p>

			{/* Worktree items */}
			<div className="divide-y divide-border rounded-xl border border-border">
				{worktrees.map((wt) => (
					<WorktreeItem
						key={wt.id}
						sandbox={wt}
						deleting={deletingIds.has(wt.id)}
						onDelete={() => onDelete(wt.id)}
					/>
				))}
			</div>
		</div>
	)
}

function WorktreeItem({
	sandbox,
	deleting,
	onDelete,
}: {
	sandbox: SandboxWithProject
	deleting: boolean
	onDelete: () => void
}) {
	const isTransitional = sandbox.status === "creating" || sandbox.status === "removing"
	const showBadge = sandbox.status !== "ready"
	const badgeColor =
		sandbox.status === "failed" ? "bg-danger/20 text-danger" : "bg-warning/20 text-warning"

	return (
		<div className="flex items-start justify-between gap-4 px-4 py-3">
			<div className="min-w-0 flex-1">
				{/* Name + optional status badge */}
				<div className="flex items-center gap-2">
					<Branch className="h-3 w-3 text-muted" aria-hidden="true" />
					<span className="text-[13px] font-medium text-foreground">{sandbox.name}</span>
					{showBadge && (
						<span
							className={cn(
								"rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-tight",
								badgeColor,
							)}
						>
							{sandbox.status}
						</span>
					)}
				</div>

				{/* Directory path — fully visible */}
				<p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-muted">
					{sandbox.directory}
				</p>

				{/* Session titles */}
				{sandbox.sessions?.length > 0 && (
					<div className="mt-2">
						<span className="text-[11px] font-medium text-muted">Sessions</span>
						<ul className="mt-1 space-y-0.5">
							{sandbox.sessions.map((s) => (
								<li key={s.id} className="text-[11px] leading-snug text-foreground/70">
									{s.title || "Untitled"}
								</li>
							))}
						</ul>
					</div>
				)}
			</div>

			<button
				type="button"
				disabled={deleting || isTransitional}
				onClick={onDelete}
				className={cn(
					"mt-0.5 shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors",
					deleting || isTransitional
						? "cursor-not-allowed bg-surface-hover text-muted"
						: "bg-danger/10 text-danger hover:bg-danger/20",
				)}
			>
				{deleting ? <Spinner /> : "Delete"}
			</button>
		</div>
	)
}

// ────────────────────────────────────────────────────────────
// Icons
// ────────────────────────────────────────────────────────────

function FolderIcon() {
	return (
		<svg
			className="h-3.5 w-3.5 text-muted"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			strokeWidth={1.5}
			aria-hidden="true"
		>
			<title>Folder</title>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
			/>
		</svg>
	)
}
