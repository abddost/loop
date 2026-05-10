/**
 * One-shot pub/sub channel that lets components outside the chat input
 * (notably the file-panel editor) push attachments into whichever
 * input-bar instance is currently mounted. The input bar subscribes on
 * mount and unsubscribes on unmount, so a chat-tab swap automatically
 * reroutes new pushes to the new instance.
 */

export interface SelectionAttachment {
	/** Workspace-relative path of the source file (e.g. "src/cart.ts"). */
	originalPath: string
	/** 1-based inclusive line range. */
	startLine: number
	endLine: number
	/** The selected text exactly as it appears in the editor (LF newlines). */
	text: string
}

type Listener = (selection: SelectionAttachment) => void

const listeners = new Set<Listener>()

export const attachmentBridge = {
	pushSelection(selection: SelectionAttachment): void {
		for (const listener of listeners) {
			try {
				listener(selection)
			} catch (err) {
				console.error("[attachment-bridge] listener threw:", err)
			}
		}
	},

	subscribe(listener: Listener): () => void {
		listeners.add(listener)
		return () => {
			listeners.delete(listener)
		}
	},
}
