import type { MetadataRoute } from "next"

export const dynamic = "force-static"

export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "Loop AI",
		short_name: "Loop AI",
		description: "Desktop coding assistant for Codex, Claude Code, Cursor, and 85+ providers.",
		start_url: "/",
		display: "standalone",
		background_color: "#080807",
		theme_color: "#080807",
		icons: [
			{
				src: "/assets/android-chrome-192x192.png",
				sizes: "192x192",
				type: "image/png",
			},
			{
				src: "/assets/android-chrome-512x512.png",
				sizes: "512x512",
				type: "image/png",
			},
		],
	}
}
