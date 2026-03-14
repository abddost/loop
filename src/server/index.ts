import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { close as closeDb, init as initDb } from "./db/index"
import { env } from "./env"
import { createLogger } from "./logger"
import { authMiddleware } from "./middleware/auth"
import { errorHandler } from "./middleware/error"
import { loggerMiddleware } from "./middleware/logger"
import { workspaceMiddleware } from "./middleware/workspace"
import {
	ProviderRegistry,
	getModelsDevData,
	loadModelsDevCache,
	onModelsDevRefresh,
	scheduleModelsDevRefresh,
} from "./provider"
import { AuthManager } from "./provider/auth"
import { allRoutes } from "./routes"
import { setAuthManager } from "./routes/provider"
import { Workspace } from "./workspace"

const log = createLogger("server")

function createApp() {
	const app = new Hono()

	// Global middleware
	app.onError(errorHandler)
	app.use("*", cors())
	app.use("*", loggerMiddleware)
	app.use("*", authMiddleware)
	app.use("*", workspaceMiddleware)

	// Mount all routes
	app.route("/", allRoutes)

	return app
}

async function main() {
	// Ensure data directories exist
	mkdirSync(env.dataDir, { recursive: true })
	mkdirSync(resolve(env.dataDir, "cache"), { recursive: true })

	// Initialize database
	initDb(env.dbPath)
	log.info("Database initialized", { path: env.dbPath })

	// Initialize auth manager (reads persisted keys from DB + auth.json)
	const auth = new AuthManager()
	ProviderRegistry.setAuth(auth)
	setAuthManager(auth)

	// Load models.dev cache (sync: L2 file → L3 snapshot → empty)
	loadModelsDevCache()

	// Build provider registry from models.dev data
	ProviderRegistry.loadFromModelsDev(getModelsDevData())
	log.info("Providers loaded", { count: ProviderRegistry.list().length })

	// Reload registry when models.dev data refreshes
	onModelsDevRefresh((data) => {
		ProviderRegistry.loadFromModelsDev(data)
	})

	// Start background models.dev refresh (5s initial delay, then hourly)
	scheduleModelsDevRefresh()

	// Create Hono app
	const app = createApp()

	// Start server
	const server = Bun.serve({
		port: env.port,
		hostname: env.host,
		fetch: app.fetch,
	})

	log.info("Server listening", { host: env.host, port: env.port })

	// Graceful shutdown
	const shutdown = async () => {
		log.info("Shutting down")
		await Workspace.disposeAll()
		closeDb()
		server.stop()
		process.exit(0)
	}

	process.on("SIGINT", shutdown)
	process.on("SIGTERM", shutdown)
}

main().catch((err) => {
	log.error("Fatal error", { error: err })
	process.exit(1)
})
