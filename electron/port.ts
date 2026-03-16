/**
 * Free port detection.
 *
 * Binds to port 0 on loopback to let the OS assign an available port,
 * reads the assigned port, then immediately closes the server.
 */

import * as net from "node:net"

export function reservePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer()
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address()
			if (!addr || typeof addr === "string") {
				server.close()
				reject(new Error("Failed to get port from server address"))
				return
			}
			const port = addr.port
			server.close(() => resolve(port))
		})
		server.on("error", reject)
	})
}
