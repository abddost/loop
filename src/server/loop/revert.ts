import type { FileDiff } from "@core/schema/part"
import type { RevertState } from "@core/schema/session"
import * as Database from "../db"
import * as queries from "../db/queries"
import { createLogger } from "../logger"
import { bus } from "../workspace/bus"
import type { SnapshotPatch } from "./snapshot"
import { snapshot } from "./snapshot"
import { getSessionStatus } from "./status"

const log = createLogger("revert")

/**
 * Revert assistant file changes back to a specific message (or part).
 * Following OpenCode's pattern:
 * 1. Collect EditParts after target → build patch list
 * 2. Save pre-revert snapshot (for unrevert)
 * 3. Per-file revert via snapshot.revert()
 * 4. Store revert state on session
 */
export async function revertToMessage(
	sessionId: string,
	messageId: string,
	partId?: string,
): Promise<{ success: boolean; revertState?: RevertState; error?: string }> {
	// Guard: session must be idle
	const status = getSessionStatus(sessionId)
	if (status !== "idle") {
		return { success: false, error: "Cannot revert while session is busy" }
	}

	const messages = queries.findMessagesBySessionId(sessionId)
	if (messages.length === 0) {
		return { success: false, error: "No messages found" }
	}

	// Walk messages to find the target and collect patches after it
	let revertPoint: { messageId: string; partId?: string } | undefined
	let lastUserMessageId: string | undefined
	const patches: SnapshotPatch[] = []

	for (const msg of messages) {
		if (msg.role === "user") lastUserMessageId = msg.id

		for (const part of msg.parts) {
			const partData = part.data as Record<string, unknown>

			// Check if this is our revert target
			if (!revertPoint) {
				if ((msg.id === messageId && !partId) || part.id === partId) {
					// If target is a message (not specific part), revert to last user message
					const resolvedPartId =
						partId &&
						msg.parts.some((p: any) => {
							const pd = p.data as Record<string, unknown>
							return p.id !== partId && (pd.type === "text" || pd.type === "tool")
						})
							? partId
							: undefined
					revertPoint = {
						messageId: resolvedPartId ? msg.id : (lastUserMessageId ?? msg.id),
						partId: resolvedPartId,
					}
				}
				continue
			}

			// After revert point: collect edit parts as patches
			if (partData.type === "edit") {
				const editData = partData as { hash: string; files: Array<string | { path: string }> }
				patches.push({
					hash: editData.hash,
					files: editData.files.map((f) => (typeof f === "string" ? f : f.path)),
				})
			}
		}
	}

	if (!revertPoint) {
		return { success: false, error: "Target message/part not found" }
	}

	// If no edit parts found, try snapshot-based approach
	const snapshotManager = await snapshot()
	let diffResult: FileDiff[] = []

	if (patches.length === 0) {
		// Find the step-start snapshot before the target
		let targetStepHash: string | undefined
		for (const msg of messages) {
			if (msg.id === revertPoint.messageId) break
			for (const part of msg.parts) {
				const pd = part.data as Record<string, unknown>
				if (pd.type === "step-start" && pd.snapshot) {
					targetStepHash = pd.snapshot as string
				}
			}
		}
		if (!targetStepHash) {
			return { success: false, error: "No snapshot available to revert to" }
		}
		// Build a single patch from the snapshot
		const patch = await snapshotManager.patch(targetStepHash)
		if (patch.files.length > 0) {
			patches.push(patch)
		}
	}

	if (patches.length === 0) {
		return { success: false, error: "No file changes to revert" }
	}

	// Capture current state for unrevert
	const preRevertHash = await snapshotManager.capture()

	// Revert the files
	await snapshotManager.revert(patches)

	// Compute diff of what was undone
	if (preRevertHash) {
		const currentHash = await snapshotManager.capture()
		if (currentHash && currentHash !== preRevertHash) {
			diffResult = await snapshotManager.diffStats(currentHash, preRevertHash)
		}
	}

	// Store revert state on session
	const revertState: RevertState = {
		messageId: revertPoint.messageId,
		partId: revertPoint.partId,
		snapshot: preRevertHash,
		diff: diffResult,
	}

	Database.withEffects((_tx, effect) => {
		queries.updateSession(sessionId, { revertState })
		effect(() => {
			const session = queries.findSessionById(sessionId)
			if (session) {
				bus().emit("session:update", { sessionId, session })
			}
		})
	})

	log.info("reverted", { sessionId, messageId: revertPoint.messageId, patches: patches.length })
	return { success: true, revertState }
}

/**
 * Undo a revert: restore files to the pre-revert state.
 */
export async function unrevert(sessionId: string): Promise<{ success: boolean; error?: string }> {
	const status = getSessionStatus(sessionId)
	if (status !== "idle") {
		return { success: false, error: "Cannot unrevert while session is busy" }
	}

	const session = queries.findSessionById(sessionId)
	if (!session?.revertState) {
		return { success: false, error: "No revert state to undo" }
	}

	const revertState = session.revertState as RevertState
	if (revertState.snapshot) {
		const snapshotManager = await snapshot()
		await snapshotManager.restore(revertState.snapshot)
	}

	Database.withEffects((_tx, effect) => {
		queries.updateSession(sessionId, { revertState: null })
		effect(() => {
			const updated = queries.findSessionById(sessionId)
			if (updated) {
				bus().emit("session:update", { sessionId, session: updated })
			}
		})
	})

	log.info("unreverted", { sessionId })
	return { success: true }
}

/**
 * Clean up after revert: remove messages/parts after the revert point.
 * Call this when the user is satisfied with the revert.
 */
export async function cleanupRevert(
	sessionId: string,
): Promise<{ success: boolean; error?: string }> {
	const session = queries.findSessionById(sessionId)
	if (!session?.revertState) {
		return { success: false, error: "No revert state to clean up" }
	}

	const revertState = session.revertState as RevertState
	const messages = queries.findMessagesBySessionId(sessionId)

	// Find the target message ordinal
	const targetMsg = messages.find((m) => m.id === revertState.messageId)
	if (!targetMsg) {
		return { success: false, error: "Target message not found" }
	}

	Database.withEffects((_tx, effect) => {
		// Delete messages after the target
		queries.deleteMessagesAfter(sessionId, targetMsg.ordinal)

		// If partial revert (specific part), delete parts after that part
		if (revertState.partId) {
			const partIdx = targetMsg.parts.findIndex((p: any) => p.id === revertState.partId)
			if (partIdx >= 0) {
				// Find the ordinal of the part to delete from
				const targetPart = targetMsg.parts[partIdx]
				if (targetPart) {
					queries.deletePartsFrom(targetMsg.id, targetPart.ordinal)
				}
			}
		}

		// Clear revert state
		queries.updateSession(sessionId, { revertState: null })

		effect(() => {
			const updated = queries.findSessionById(sessionId)
			if (updated) {
				bus().emit("session:update", { sessionId, session: updated })
			}
		})
	})

	log.info("revert cleaned up", { sessionId })
	return { success: true }
}
