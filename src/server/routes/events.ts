import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { globalBus } from "../bus/global"
import { AsyncQueue } from "../lib/async-queue"

export const eventRoutes = new Hono()

/**
 * GET /global/events — SSE endpoint for real-time global events.
 *
 * All workspace events are multiplexed onto a single stream via GlobalBus.
 * The client identifies which workspace each event belongs to via the
 * `directory` field.
 *
 * Reliability architecture (mirrors opencode's production-grade pattern):
 *   - `AsyncQueue` decouples bus emission from socket writes. A slow client
 *     can no longer block GlobalBus.emit(); items accumulate in the queue.
 *   - 10s heartbeat (vs. 60s typical proxy/WebView idle timeout) so a stalled
 *     connection is detected an order of magnitude faster than before.
 *   - Sentinel push (`q.push(null)`) cleanly unblocks the consumer loop on
 *     disconnect — no need to race writeSSE against the abort signal.
 *   - `X-Accel-Buffering: no` disables buffering at any nginx-style proxy
 *     (Electron's local WebView doesn't add one, but the header is harmless
 *     and useful for any future deployment behind a reverse proxy).
 *
 * Protocol:
 *   1. On connect: sends `server.connected` (signals fresh stream to client)
 *   2. Continuous: forwards GlobalBus events as JSON SSE data lines
 *   3. Every 10s: sends `heartbeat` event
 *   4. On disconnect: unsubscribes, clears heartbeat, push sentinel to drain
 */
eventRoutes.get("/global/events", (c) => {
	c.header("X-Accel-Buffering", "no")
	c.header("X-Content-Type-Options", "nosniff")

	return streamSSE(c, async (stream) => {
		const queue = new AsyncQueue<string | null>()
		let stopped = false

		queue.push(JSON.stringify({ type: "server.connected" }))

		const unsubscribe = globalBus.subscribe((event) => {
			queue.push(JSON.stringify(event))
		})

		const heartbeat = setInterval(() => {
			queue.push(JSON.stringify({ type: "heartbeat" }))
		}, 10_000)

		const stop = () => {
			if (stopped) return
			stopped = true
			clearInterval(heartbeat)
			unsubscribe()
			queue.push(null) // sentinel — wakes the consumer loop so it can exit
		}

		stream.onAbort(stop)

		try {
			for await (const data of queue) {
				if (data === null) return
				await stream.writeSSE({ data })
			}
		} finally {
			stop()
		}
	})
})
