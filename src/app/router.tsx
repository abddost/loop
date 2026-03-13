import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router"
import { RootLayout } from "./routes/__root"
import { IndexPage } from "./routes/index-page"
import { SettingsPage } from "./routes/settings-page"
import { SessionPage } from "./routes/workspace/session-page"
import { WorkspaceLayout } from "./routes/workspace/workspace-layout"

const rootRoute = createRootRoute({
	component: RootLayout,
})

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: IndexPage,
})

const workspaceRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/workspace/$dir",
	component: WorkspaceLayout,
})

const workspaceIndexRoute = createRoute({
	getParentRoute: () => workspaceRoute,
	path: "/",
	component: SessionPage,
})

const sessionRoute = createRoute({
	getParentRoute: () => workspaceRoute,
	path: "/session/$id",
	component: SessionPage,
})

const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings",
	component: SettingsPage,
})

const routeTree = rootRoute.addChildren([
	indexRoute,
	workspaceRoute.addChildren([workspaceIndexRoute, sessionRoute]),
	settingsRoute,
])

export const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router
	}
}
