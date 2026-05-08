/**
 * Mutable text buffer for high-frequency streaming deltas, with built-in
 * metronome-paced reveal so consumers see one word every ~30ms regardless
 * of how quickly the source delivered the underlying text.
 *
 * Why pacing lives here:
 *   The streamdown playground feels perfectly sequential because its demo
 *   uses `setInterval(emit_one_word, 30ms)`. Streamdown's per-word fade-in
 *   is much longer than the inter-token interval, so adjacent words have
 *   overlapping fades — producing a continuous shimmer rather than
 *   synchronized blooms.
 *
 *   Real network streaming has none of that regularity: Anthropic emits
 *   ~50–150 tokens/sec in bursts, the SSE client coalesces by RAF (~16ms),
 *   and a fast burst lands 30+ words into a single React render. Without
 *   pacing, streamdown's animate plugin fades all those words together
 *   inside one render → reads as parallel-everywhere.
 *
 *   We do the pacing client-side (here) instead of via the AI SDK's
 *   `smoothStream` transform on the server because Loop has THREE
 *   streaming adapters (AI SDK, Claude Agent SDK, Cursor SDK) and only
 *   the AI SDK path supports `experimental_transform`. Pacing here covers
 *   all three uniformly and avoids holding SSE connections open longer.
 *
 * Lifecycle per streaming part:
 *   1. First delta  → append() returns true (isNew)
 *                     → caller creates one-time placeholder in Zustand
 *   2. More deltas  → append() accumulates text silently in `texts`
 *   3. RAF metronome → advances `revealed` one word at a time, paced to
 *                      PACE_INTERVAL_MS, notifies subscribers each step
 *   4. flush()      → bumps version once per RAF batch (used so React
 *                     mounts a new partId's component on first delta)
 *   5. commit()     → snaps `revealed` to full so the upsert hand-off
 *                     doesn't leave words mid-fade, then RAF-cleans up
 *
 * Math guard:
 *   Advancing reveal mid-`$$..$$` causes KaTeX to re-render with new
 *   content on every step → visible flicks + layout shifts. The metronome
 *   pauses at an opening `$$` until the closing `$$` is in the source,
 *   then advances through the whole math region in one step.
 *
 * Tunables (chosen to match streamdown's playground feel):
 *   PACE_INTERVAL_MS = 30 — matches the playground default
 *   advance step      = exactly one word boundary per tick (consistent
 *                       rhythm regardless of word length)
 */
class StreamingBuffer {
	private texts = new Map<string, string>()
	private revealed = new Map<string, number>()
	private version = 0
	private listeners = new Set<() => void>()
	private paceFrameId: number | null = null
	private lastTickAt = 0

	private static readonly PACE_INTERVAL_MS = 30

	/**
	 * Append delta text for a part. Does NOT notify subscribers directly —
	 * the metronome handles per-tick notifications during reveal, and the
	 * caller still calls flush() once per SSE batch so React picks up the
	 * new partId on its first delta.
	 * @returns true if this is the first delta for this partId
	 */
	append(partId: string, delta: string): boolean {
		const isNew = !this.texts.has(partId)
		this.texts.set(partId, (this.texts.get(partId) ?? "") + delta)
		if (isNew) this.revealed.set(partId, 0)
		this.startPace()
		return isNew
	}

	/**
	 * Get current REVEALED prefix of a streaming part. Returns the text up
	 * to the metronome's current `revealed` cursor, which advances at
	 * PACE_INTERVAL_MS regardless of how fast the source delivered chars.
	 */
	get(partId: string): string | undefined {
		const full = this.texts.get(partId)
		if (full === undefined) return undefined
		const r = this.revealed.get(partId) ?? 0
		return full.slice(0, r)
	}

	has(partId: string): boolean {
		return this.texts.has(partId)
	}

	/**
	 * Commit (finalize) a streaming part. Snaps reveal to full so no words
	 * are mid-fade when the Zustand upsert lands, then RAF-cleans the entry
	 * so subscribers fall back to the store's `part.text` field.
	 */
	commit(partId: string): void {
		const full = this.texts.get(partId)
		if (full === undefined) return
		// Snap reveal to full immediately — once an upsert is in flight, the
		// final canonical text is about to render from the store and any
		// remaining metronome tail would either get cut off or fight the
		// store's full-text render. One clean snap is the smoother behavior.
		this.revealed.set(partId, full.length)
		this.version++
		this.notify()
		// Defer cleanup to next frame so the Zustand upsertPart() update
		// propagates to React before streamingText becomes undefined.
		requestAnimationFrame(() => {
			if (this.texts.delete(partId)) {
				this.revealed.delete(partId)
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
		if (this.texts.size === 0) return
		this.texts.clear()
		this.revealed.clear()
		this.stopPace()
		this.version++
		this.notify()
	}

	/**
	 * Bump version + notify subscribers once per SSE batch. The metronome
	 * already notifies on each pace tick, but a fresh partId may not be on
	 * the metronome yet when its first delta lands — flush() ensures
	 * useSyncExternalStore observes the new partId without waiting up to
	 * PACE_INTERVAL_MS.
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

	/**
	 * RAF-driven pacing. We use rAF rather than setInterval so each tick is
	 * aligned to a paint frame — eliminates the "30ms timer fires but next
	 * paint isn't for 16ms" jitter that setInterval produces, and means the
	 * user sees each new word at the next visible frame after we advance.
	 */
	private startPace(): void {
		if (this.paceFrameId !== null) return
		if (typeof window === "undefined") return
		this.lastTickAt = performance.now()
		const frame = (now: number) => {
			if (now - this.lastTickAt >= StreamingBuffer.PACE_INTERVAL_MS) {
				this.tick()
				this.lastTickAt = now
			}
			// stopPace() may have nulled paceFrameId from inside tick()
			if (this.paceFrameId !== null) {
				this.paceFrameId = requestAnimationFrame(frame)
			}
		}
		this.paceFrameId = requestAnimationFrame(frame)
	}

	private stopPace(): void {
		if (this.paceFrameId === null) return
		cancelAnimationFrame(this.paceFrameId)
		this.paceFrameId = null
	}

	private tick(): void {
		let anyAdvance = false
		let anyPending = false
		for (const [partId, full] of this.texts) {
			const cur = this.revealed.get(partId) ?? 0
			if (cur >= full.length) continue
			anyPending = true

			// Advance to next word boundary — exactly one word per tick.
			const wsAfter = full.indexOf(" ", cur)
			let next = wsAfter === -1 ? full.length : wsAfter + 1

			// Pause reveal inside an incomplete $$..$$ math region. Without
			// this guard, KaTeX re-parses partial source on every tick and
			// the rendered element flicks/resizes → visible content shifts.
			next = guardIncompleteMath(full, cur, next)

			if (next > cur) {
				this.revealed.set(partId, next)
				anyAdvance = true
			}
		}
		if (anyAdvance) {
			this.version++
			this.notify()
		}
		// Stop the metronome once everything caught up. Restarts on next append().
		if (!anyPending) this.stopPace()
	}
}

/**
 * Walk the [cur, target) range and pause at any opening `$$` whose
 * closing `$$` hasn't arrived yet. If the math region is complete in
 * `full`, advance past it atomically so the math appears as a complete
 * unit (no progressive partial-render flicker).
 *
 * Returns the safe target position to advance to.
 */
function guardIncompleteMath(full: string, cur: number, target: number): number {
	let pos = cur
	let safeTarget = target
	while (pos < safeTarget) {
		const opening = full.indexOf("$$", pos)
		if (opening === -1 || opening >= safeTarget) break
		const closing = full.indexOf("$$", opening + 2)
		if (closing === -1) {
			// Source has an opening $$ but no closing yet — pause just before it.
			return opening
		}
		// Math is complete in source — advance through it (and bump target so
		// we don't truncate mid-math).
		safeTarget = Math.max(safeTarget, closing + 2)
		pos = closing + 2
	}
	return safeTarget
}

export const streamingBuffer = new StreamingBuffer()
