/**
 * Mutable text buffer for high-frequency streaming deltas.
 *
 * During LLM streaming, text arrives as many small deltas (50-100+ per second).
 * Storing each delta in Zustand would create a new state tree per token via immer,
 * causing O(state_size) work per delta — too expensive for React.
 *
 * This buffer accumulates deltas in a plain Map outside of React state.
 * Components read from it via `useSyncExternalStore`, which only re-renders
 * the specific components that consume changed data.
 *
 * Lifecycle per streaming part:
 *   1. First delta arrives  → append() returns true (isNew)
 *                             → caller creates one-time placeholder in Zustand
 *   2. More deltas arrive   → append() accumulates text silently
 *   3. After batch of deltas → flush() notifies subscribers once per frame
 *   4. part:upsert arrives  → commit() removes entry, notifies subscribers
 *
 * Result: 2 Zustand updates per part (placeholder + final) instead of 100+.
 */
class StreamingBuffer {
	private texts = new Map<string, string>()
	private version = 0
	private listeners = new Set<() => void>()

	/**
	 * Append delta text for a part. Does NOT notify subscribers —
	 * call flush() after processing a batch of deltas.
	 * @returns true if this is the first delta for this partId
	 */
	append(partId: string, delta: string): boolean {
		const isNew = !this.texts.has(partId)
		this.texts.set(partId, (this.texts.get(partId) ?? "") + delta)
		return isNew
	}

	/** Get current accumulated text for a streaming part. */
	get(partId: string): string | undefined {
		return this.texts.get(partId)
	}

	/** Check if a part is currently streaming. */
	has(partId: string): boolean {
		return this.texts.has(partId)
	}

	/**
	 * Commit (finalize) a streaming part. Removes from buffer and notifies subscribers.
	 * Called when part:upsert arrives with the final part data.
	 *
	 * The caller must update Zustand BEFORE calling commit() so that
	 * components fall back to part.text (from Zustand) when streamingText becomes undefined.
	 */
	commit(partId: string): void {
		if (!this.texts.has(partId)) return
		// Defer cleanup to next frame so the Zustand upsertPart() update
		// propagates to React before streamingText becomes undefined.
		// During the extra frame, buffer still returns the same final text.
		requestAnimationFrame(() => {
			if (this.texts.delete(partId)) {
				this.version++
				this.notify()
			}
		})
	}

	/**
	 * Clear all streaming state. Called on SSE reconnection.
	 * After clearing, components fall back to Zustand store data.
	 */
	clear(): void {
		if (this.texts.size > 0) {
			this.texts.clear()
			this.version++
			this.notify()
		}
	}

	/**
	 * Notify subscribers of accumulated changes.
	 * Call once after processing a batch of deltas (at end of RAF flush).
	 */
	flush(): void {
		this.version++
		this.notify()
	}

	/** Version counter for useSyncExternalStore snapshot identity. */
	getVersion(): number {
		return this.version
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	private notify(): void {
		for (const listener of this.listeners) {
			listener()
		}
	}
}

export const streamingBuffer = new StreamingBuffer()
