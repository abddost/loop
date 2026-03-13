import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { globalBus } from "../bus/global"

export const eventRoutes = new Hono()

/**
 * GET /global/events — SSE endpoint for real-time global events.
 *
 * All workspace events are multiplexed onto a single stream via GlobalBus.
 * The client identifies which workspace each event belongs to via the `directory` field.
 *
 * Protocol:
 *   1. On connect: sends `server.connected` event (signals fresh stream to client)
 *   2. Continuous: forwards GlobalBus events as JSON SSE data lines
 *   3. Every 30s: sends `heartbeat` event (prevents proxy/WebView timeouts)
 *   4. On disconnect: cleans up subscription and heartbeat timer
 *
 * Error handling:
 *   - writeSSE failures are caught silently (client already disconnected)
 *   - The stream stays alive via an await that resolves only on abort
 */
eventRoutes.get("/global/events", (c) => {
	return streamSSE(c, async (stream) => {
		// Signal the client that the stream is ready.
		// On reconnection, the client uses this to trigger state refetch.
		await stream.writeSSE({ data: JSON.stringify({ type: "server.connected" }) }).catch(() => {})

		// Forward all global events to this SSE client
		const unsubscribe = globalBus.subscribe((event) => {
			stream.writeSSE({ data: JSON.stringify(event) }).catch(() => {
				// Client disconnected — onAbort handler below handles cleanup.
			})
		})

		// Heartbeat every 30s to prevent proxy/WebView idle timeouts (typically 60s)
		const heartbeat = setInterval(() => {
			stream.writeSSE({ data: JSON.stringify({ type: "heartbeat" }) }).catch(() => {})
		}, 30_000)

		// Keep the stream alive until the client disconnects.
		// This replaces the old polling loop with a clean promise-based wait.
		await new Promise<void>((resolve) => {
			stream.onAbort(() => {
				unsubscribe()
				clearInterval(heartbeat)
				resolve()
			})
		})
	})
})
