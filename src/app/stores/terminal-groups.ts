/**
 * Pure helpers for terminal split-group state.
 *
 * A group represents a row of side-by-side terminals rendered as a CSS grid.
 * The server has no concept of groups — they are a UI-only layout primitive.
 */

export interface TerminalGroup {
	id: string
	terminalIds: string[]
}

export const MAX_TERMINALS_PER_GROUP = 4

function makeGroupId(terminalId: string): string {
	return `group-${terminalId}`
}

function uniqueGroupId(base: string, used: Set<string>): string {
	let candidate = base
	let n = 2
	while (used.has(candidate)) {
		candidate = `${base}-${n}`
		n += 1
	}
	used.add(candidate)
	return candidate
}

/**
 * Build groups from a flat list of server terminal IDs, preserving any
 * grouping from a prior state when the same IDs are still present.
 */
export function hydrateGroups(
	terminalIds: string[],
	previousGroups?: TerminalGroup[],
): TerminalGroup[] {
	const present = new Set(terminalIds)
	const placed = new Set<string>()
	const usedIds = new Set<string>()
	const result: TerminalGroup[] = []

	if (previousGroups) {
		for (const group of previousGroups) {
			const keep = group.terminalIds.filter((id) => present.has(id) && !placed.has(id))
			if (keep.length === 0) continue
			for (const id of keep) placed.add(id)
			result.push({
				id: uniqueGroupId(group.id, usedIds),
				terminalIds: keep,
			})
		}
	}

	// Each un-placed terminal becomes its own group, preserving insertion order
	for (const id of terminalIds) {
		if (placed.has(id)) continue
		placed.add(id)
		result.push({
			id: uniqueGroupId(makeGroupId(id), usedIds),
			terminalIds: [id],
		})
	}

	return result
}

/**
 * Find the group containing `terminalId`, or null.
 */
export function findGroupByTerminal(
	groups: TerminalGroup[],
	terminalId: string,
): TerminalGroup | null {
	return groups.find((g) => g.terminalIds.includes(terminalId)) ?? null
}

/**
 * Add `terminalId` to the active group (split). Caller must have already
 * verified the group is not full via `isActiveGroupFull`.
 *
 * If no active group is found, a new group is created.
 * Returns the new groups and the group ID the terminal landed in.
 */
export function splitIntoGroup(
	groups: TerminalGroup[],
	terminalId: string,
	activeGroupId: string | null,
): { groups: TerminalGroup[]; groupId: string } {
	const targetIdx = activeGroupId ? groups.findIndex((g) => g.id === activeGroupId) : -1

	if (targetIdx < 0) {
		// Fallback: create new group if no active group exists
		return newGroup(groups, terminalId)
	}

	const target = groups[targetIdx]!
	const nextGroups = groups.map((g, i) =>
		i === targetIdx ? { ...g, terminalIds: [...g.terminalIds, terminalId] } : g,
	)
	return { groups: nextGroups, groupId: target.id }
}

/**
 * Append a new group containing only `terminalId`.
 */
export function newGroup(
	groups: TerminalGroup[],
	terminalId: string,
): { groups: TerminalGroup[]; groupId: string } {
	const used = new Set(groups.map((g) => g.id))
	const id = uniqueGroupId(makeGroupId(terminalId), used)
	return {
		groups: [...groups, { id, terminalIds: [terminalId] }],
		groupId: id,
	}
}

/**
 * Remove `terminalId` from all groups, drop empty groups, and suggest a new
 * active terminal + group. When the closed terminal was active, the successor
 * is chosen at the same position within its former group.
 */
export function closeFromGroups(
	groups: TerminalGroup[],
	terminalId: string,
	activeTerminalId: string | null,
	activeGroupId: string | null,
): {
	groups: TerminalGroup[]
	activeTerminalId: string | null
	activeGroupId: string | null
} {
	const sourceGroup = findGroupByTerminal(groups, terminalId)
	const sourceIndexInGroup = sourceGroup?.terminalIds.indexOf(terminalId) ?? -1

	const nextGroups: TerminalGroup[] = []
	for (const group of groups) {
		const kept = group.terminalIds.filter((id) => id !== terminalId)
		if (kept.length > 0) nextGroups.push({ ...group, terminalIds: kept })
	}

	if (nextGroups.length === 0) {
		return { groups: [], activeTerminalId: null, activeGroupId: null }
	}

	const wasActive = activeTerminalId === terminalId
	if (!wasActive) {
		// Active terminal unchanged; ensure active group still exists
		const stillHasActiveGroup = activeGroupId
			? nextGroups.some((g) => g.id === activeGroupId)
			: false
		const nextActiveGroup = stillHasActiveGroup
			? activeGroupId
			: (nextGroups.find((g) => g.terminalIds.includes(activeTerminalId ?? ""))?.id ??
				nextGroups[0]!.id)
		return {
			groups: nextGroups,
			activeTerminalId,
			activeGroupId: nextActiveGroup,
		}
	}

	// Active terminal was closed: pick successor in same former group (if kept),
	// otherwise the first terminal of the first remaining group.
	const keptSource = sourceGroup ? nextGroups.find((g) => g.id === sourceGroup.id) : null
	if (keptSource && sourceIndexInGroup >= 0) {
		const pickAt = Math.min(sourceIndexInGroup, keptSource.terminalIds.length - 1)
		return {
			groups: nextGroups,
			activeTerminalId: keptSource.terminalIds[pickAt] ?? null,
			activeGroupId: keptSource.id,
		}
	}

	const first = nextGroups[0]!
	return {
		groups: nextGroups,
		activeTerminalId: first.terminalIds[0] ?? null,
		activeGroupId: first.id,
	}
}

/**
 * Is the currently-active group at its terminal limit?
 */
export function isActiveGroupFull(groups: TerminalGroup[], activeGroupId: string | null): boolean {
	const group = activeGroupId ? groups.find((g) => g.id === activeGroupId) : null
	if (!group) return false
	return group.terminalIds.length >= MAX_TERMINALS_PER_GROUP
}
