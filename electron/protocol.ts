/**
 * Custom loop:// protocol for serving static files in production.
 *
 * In production builds, the frontend is served via a custom Electron
 * protocol instead of file:// to avoid CORS and fetch restrictions.
 * Provides SPA fallback (non-asset paths return index.html).
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { app, net, protocol } from "electron"

const SCHEME = "loop"

// MIME types for common frontend assets
const MIME_TYPES: Record<string, string> = {
	".html": "text/html",
	".js": "application/javascript",
	".mjs": "application/javascript",
	".css": "text/css",
	".json": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".eot": "application/vnd.ms-fontobject",
	".webp": "image/webp",
	".avif": "image/avif",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".wasm": "application/wasm",
	".map": "application/json",
}

/**
 * Register the custom scheme as privileged.
 * Must be called BEFORE app.whenReady() — at module top level.
 */
export function registerScheme(): void {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: SCHEME,
			privileges: {
				standard: true,
				secure: true,
				supportFetchAPI: true,
				corsEnabled: true,
				stream: true,
			},
		},
	])
}

/**
 * Register the file protocol handler.
 * Must be called AFTER app.whenReady().
 * Serves files from the Vite build output directory (dist/).
 */
export function registerProtocolHandler(): void {
	const staticRoot = path.join(app.getAppPath(), "dist")

	protocol.handle(SCHEME, (request) => {
		const url = new URL(request.url)
		let filePath = decodeURIComponent(url.pathname)

		// Remove leading slash for path resolution
		if (filePath.startsWith("/")) {
			filePath = filePath.slice(1)
		}

		// Resolve and validate path (prevent traversal)
		const resolved = path.resolve(staticRoot, filePath)
		if (!resolved.startsWith(staticRoot)) {
			return new Response("Forbidden", { status: 403 })
		}

		// Check if file exists; if not, SPA fallback to index.html
		const target = fs.existsSync(resolved) ? resolved : path.join(staticRoot, "index.html")
		const ext = path.extname(target).toLowerCase()
		const mimeType = MIME_TYPES[ext] || "application/octet-stream"

		return net.fetch(`file://${target}`, {
			headers: { "Content-Type": mimeType },
		})
	})
}
