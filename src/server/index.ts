import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import { Hono } from "hono"
import { cors } from "hono/cors"
import * as Config from "./config"
import { close as closeDb, init as initDb } from "./db/index"
import { deleteConfigValue, getAllConfig } from "./db/queries"
import { env } from "./env"
import { drainAll } from "./lib/background-tasks"
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
	registerAuthHandler,
	scheduleModelsDevRefresh,
} from "./provider"
import { AuthManager } from "./provider/auth"
import {
	antigravityHandler,
	antigravityProvider,
	discoverAntigravityModels,
} from "./provider/handlers/antigravity"
import { codexHandler } from "./provider/handlers/codex"
import { copilotHandler } from "./provider/handlers/copilot"
import { cursorHandler, cursorProvider, discoverCursorModels } from "./provider/handlers/cursor"
import { allRoutes } from "./routes"
import { setAuthManager } from "./routes/provider"
import { Workspace } from "./workspace"
import { websocket } from "./ws"

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

	// Initialize unified config file (migrates old permissions.json + DB values)
	Config.ensure(() => {
		const stored = getAllConfig()
		const appKeys = ["theme", "defaultAgent", "defaultModel", "approvalPolicy"]
		const hasAppKeys = appKeys.some((k) => k in stored)
		if (!hasAppKeys) return undefined

		// Delete migrated keys from DB (keep provider: keys for AuthManager)
		for (const key of appKeys) {
			if (key in stored) deleteConfigValue(key)
		}
		return stored
	})

	// Initialize auth manager (reads persisted keys from DB + auth.json)
	const auth = new AuthManager()
	ProviderRegistry.setAuth(auth)
	setAuthManager(auth)

	// Register auth handlers for OAuth-capable providers
	registerAuthHandler(copilotHandler)
	registerAuthHandler(codexHandler)
	registerAuthHandler(antigravityHandler)
	registerAuthHandler(cursorHandler)

	// Register subscription-only providers (not from models.dev)
	ProviderRegistry.register(antigravityProvider)
	ProviderRegistry.register(cursorProvider)

	// Discover models in the background (updates providers when done)
	discoverCursorModels().then((models) => {
		cursorProvider.models = models
	})
	discoverAntigravityModels().then((models) => {
		antigravityProvider.models = models
	})

	// Load models.dev cache (sync: file cache → empty)
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
		websocket,
	})

	log.info("Server listening", { host: env.host, port: env.port })

	// Graceful shutdown
	const shutdown = async () => {
		log.info("Shutting down")
		await Workspace.disposeAll()
		await drainAll()
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
