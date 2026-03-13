import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { resolve } from "node:path"

export default defineConfig({
	root: "src/app",
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
			"@core": resolve(__dirname, "src/core"),
			"@server": resolve(__dirname, "src/server"),
			"@app": resolve(__dirname, "src/app"),
		},
	},
	server: {
		port: 1420,
		strictPort: true,
	},
	build: {
		outDir: resolve(__dirname, "dist"),
		emptyOutDir: true,
	},
})
