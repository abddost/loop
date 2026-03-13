import { resolve } from "node:path"
import { defineConfig } from "drizzle-kit"
import { getDataDir } from "./src/server/env"

export default defineConfig({
	schema: "./src/server/db/tables/*.ts",
	out: "./drizzle",
	dialect: "sqlite",
	verbose: true,
	dbCredentials: {
		url: resolve(getDataDir(), "loop.db"),
	},
})
