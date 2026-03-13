import { defineConfig } from "drizzle-kit"

export default defineConfig({
	schema: "./src/server/db/tables/*.ts",
	out: "./drizzle",
	dialect: "sqlite",
	verbose: true,
	dbCredentials: {
		url: "./loop.db",
	},
})
