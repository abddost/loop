import { type RefObject, useEffect, useRef } from "react"

/**
 * Drives a sub-pixel-smooth reveal of streaming text by animating a
 * `--reveal` CSS variable (0..1) on `ref`. Markdown is rendered in full
 * each chunk; CSS uses `--reveal` to drive a vertical gradient mask so
 * the trailing edge fades up as content arrives. There are no
 * character-quantized DOM mutations during the reveal — only one CSS
 * variable update per animation frame, which the compositor handles
 * cheaply on its own thread.
 *
 * On each text update we re-anchor the reveal to preserve the number
 * of visible characters across the change (so the user never sees
 * already-revealed text snap backwards), then ease the value back to
 * 1.0 with a cubic ease-out.
 *
 * Honors `prefers-reduced-motion` by jumping `--reveal` straight to 1.
 */
export function useStreamingReveal(
	ref: RefObject<HTMLElement | null>,
	text: string,
	durationMs = 1000,
): void {
	const prevTextLengthRef = useRef(0)
	const currentRevealRef = useRef(1)

	useEffect(() => {
		const el = ref.current
		if (!el) return

		// Empty text: reset the variable; nothing to animate.
		if (text.length === 0) {
			el.style.setProperty("--reveal", "1")
			currentRevealRef.current = 1
			prevTextLengthRef.current = 0
			return
		}

		// Reduced-motion: snap to fully revealed.
		const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
		if (reduceMotion) {
			el.style.setProperty("--reveal", "1")
			currentRevealRef.current = 1
			prevTextLengthRef.current = text.length
			return
		}

		// Translate the in-flight reveal to the new text basis so the
		// already-visible character count is preserved across the update.
		const visibleChars = currentRevealRef.current * prevTextLengthRef.current
		const start = Math.min(visibleChars / text.length, 1)
		prevTextLengthRef.current = text.length

		el.style.setProperty("--reveal", String(start))
		currentRevealRef.current = start

		// Already at end? No animation needed.
		if (start >= 1) return

		const startTime = performance.now()
		let rafId = 0

		const tick = (now: number) => {
			const t = Math.min((now - startTime) / durationMs, 1)
			const eased = 1 - (1 - t) ** 3 // cubic ease-out
			const value = start + (1 - start) * eased
			el.style.setProperty("--reveal", String(value))
			currentRevealRef.current = value
			if (t < 1) rafId = requestAnimationFrame(tick)
		}

		rafId = requestAnimationFrame(tick)
		return () => cancelAnimationFrame(rafId)
	}, [ref, text, durationMs])
}
