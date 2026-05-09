import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

export default defineConfig({
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
			"@core": resolve(__dirname, "src/core"),
			"@server": resolve(__dirname, "src/server"),
			"@app": resolve(__dirname, "src/app"),
		},
	},
	test: {
		globals: true,
		environment: "node",
		include: ["src/**/*.test.ts"],
		testTimeout: 10_000,
		server: {
			deps: {
				inline: ["zod"],
			},
		},
	},
})
