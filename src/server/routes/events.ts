import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { globalBus } from "../bus/global"

export const eventRoutes = new Hono()

/** GET /global/events - SSE endpoint for real-time global events. */
eventRoutes.get("/global/events", (c) => {
	return streamSSE(c, async (stream) => {
		const unsubscribe = globalBus.subscribe((event) => {
			stream.writeSSE({ data: JSON.stringify(event) })
		})

		const heartbeat = setInterval(() => {
			stream.writeSSE({ data: JSON.stringify({ type: "heartbeat" }) })
		}, 30_000)

		stream.onAbort(() => {
			unsubscribe()
			clearInterval(heartbeat)
		})

		// Keep the stream alive until the client disconnects
		while (!stream.closed) {
			await new Promise((resolve) => setTimeout(resolve, 1000))
		}
	})
})
