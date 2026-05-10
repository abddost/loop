import { useMemo } from "react"
import { cn } from "../ui/cn"

export interface DiffChangesProps {
	additions: number
	deletions: number
	variant?: "default" | "bars"
	className?: string
}

const TOTAL_BLOCKS = 5

function computeBlockCounts(additions: number, deletions: number) {
	if (additions === 0 && deletions === 0) {
		return { added: 0, deleted: 0, neutral: TOTAL_BLOCKS }
	}

	const total = additions + deletions

	if (total < 5) {
		const added = additions > 0 ? 1 : 0
		const deleted = deletions > 0 ? 1 : 0
		return { added, deleted, neutral: TOTAL_BLOCKS - added - deleted }
	}

	const ratio = additions > deletions ? additions / deletions : deletions / additions
	let blocksForColors = TOTAL_BLOCKS
	if (total < 20 || ratio < 4) blocksForColors = TOTAL_BLOCKS - 1

	const addedRaw = (additions / total) * blocksForColors
	const deletedRaw = (deletions / total) * blocksForColors

	let added = additions > 0 ? Math.max(1, Math.round(addedRaw)) : 0
	let deleted = deletions > 0 ? Math.max(1, Math.round(deletedRaw)) : 0

	if (additions > 0 && additions <= 5) added = Math.min(added, 1)
	if (additions > 5 && additions <= 10) added = Math.min(added, 2)
	if (deletions > 0 && deletions <= 5) deleted = Math.min(deleted, 1)
	if (deletions > 5 && deletions <= 10) deleted = Math.min(deleted, 2)

	if (added + deleted > blocksForColors) {
		if (addedRaw > deletedRaw) added = blocksForColors - deleted
		else deleted = blocksForColors - added
	}

	const neutral = Math.max(0, TOTAL_BLOCKS - added - deleted)
	return { added, deleted, neutral }
}

export function DiffChanges({
	additions,
	deletions,
	variant = "default",
	className,
}: DiffChangesProps) {
	const blocks = useMemo(() => {
		if (variant !== "bars") return null
		const { added, deleted, neutral } = computeBlockCounts(additions, deletions)
		const out: Array<"add" | "del" | "neutral"> = []
		for (let i = 0; i < added; i++) out.push("add")
		for (let i = 0; i < deleted; i++) out.push("del")
		for (let i = 0; i < neutral; i++) out.push("neutral")
		return out.slice(0, TOTAL_BLOCKS)
	}, [additions, deletions, variant])

	if (variant === "default") {
		if (additions === 0 && deletions === 0) return null
		return (
			<span className={cn("flex items-center gap-1 text-xs font-mono tabular-nums", className)}>
				{additions > 0 && <span className="text-diff-add">+{additions}</span>}
				{deletions > 0 && <span className="text-diff-remove">-{deletions}</span>}
			</span>
		)
	}

	return (
		<svg
			viewBox="0 0 18 14"
			fill="none"
			aria-hidden="true"
			className={cn("h-3 w-[18px] shrink-0", className)}
		>
			{blocks?.map((kind, i) => (
				<rect
					// biome-ignore lint/suspicious/noArrayIndexKey: positional blocks
					key={i}
					x={i * 4}
					width="2"
					height="14"
					rx="1"
					className={
						kind === "add" ? "fill-diff-add" : kind === "del" ? "fill-diff-remove" : "fill-muted/40"
					}
				/>
			))}
		</svg>
	)
}
