import { dirname } from "node:path"
import { fileURLToPath } from "node:url"
import type { NextConfig } from "next"

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

const nextConfig: NextConfig = {
	output: "export",
	trailingSlash: false,
	images: {
		unoptimized: true,
	},
	turbopack: {
		root,
	},
}

export default nextConfig
