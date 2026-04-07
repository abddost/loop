import { useMemo } from "react"
import { type WorktreeInfo, useWorktreeStore } from "../../stores/worktree-store"
import { Select } from "../ui/select"

export interface WorktreeSelectorProps {
	parentDirectory: string
	hasGit: boolean
}

/**
 * Inline worktree selector for the new-session hero.
 * Only renders when the project has git VCS.
 */
export function WorktreeSelector({ parentDirectory, hasGit }: WorktreeSelectorProps) {
	const selected = useWorktreeStore((s) => s.newSessionWorktree)
	const allWorktrees = useWorktreeStore((s) => s.worktrees)
	const worktrees = useMemo(() => {
		const result: WorktreeInfo[] = []
		for (const wt of allWorktrees.values()) {
			if (wt.parentDirectory === parentDirectory) result.push(wt)
		}
		return result
	}, [allWorktrees, parentDirectory])

	const setTarget = useWorktreeStore((s) => s.setNewSessionWorktree)

	const options = useMemo(() => {
		const opts = [{ value: "main", label: "Main workspace" }]

		for (const wt of worktrees) {
			if (wt.status === "ready" || wt.status === "creating") {
				opts.push({
					value: wt.directory,
					label: `${wt.branch}${wt.status === "creating" ? " (creating...)" : ""}`,
				})
			}
		}

		opts.push({ value: "create", label: "+ New sandbox" })

		return opts
	}, [worktrees])

	if (!hasGit) return null

	return (
		<Select
			value={selected}
			onChange={(value) => {
				if (value) setTarget(value as "main" | "create" | string)
			}}
			options={options}
			placeholder="Select workspace"
			className="mx-auto mt-1 min-w-[180px] text-center text-sm"
		/>
	)
}
