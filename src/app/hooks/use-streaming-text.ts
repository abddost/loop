import { useCallback, useSyncExternalStore } from "react"
import { streamingBuffer } from "../lib/streaming-buffer"

const subscribe = (cb: () => void) => streamingBuffer.subscribe(cb)

/**
 * Read streaming text for a part during active LLM streaming.
 *
 * Returns accumulated text from the streaming buffer, or undefined
 * if the part is not currently streaming.
 *
 * Only subscribes to buffer notifications when partId is non-null,
 * so historical messages incur zero overhead.
 *
 * Usage in part renderers:
 *   const streamingText = useStreamingText(isStreaming ? partId : null)
 *   const displayText = streamingText ?? part.text
 */
export function useStreamingText(partId: string | null): string | undefined {
	const getSnapshot = useCallback(
		() => (partId ? streamingBuffer.get(partId) : undefined),
		[partId],
	)
	return useSyncExternalStore(subscribe, getSnapshot)
}
