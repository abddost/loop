import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router"
import { RootLayout } from "./routes/__root"
import { IndexPage } from "./routes/index-page"
import { FilePanelPopoutPage } from "./routes/popout/file-panel-page"
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
	// Rendered as a fixed overlay in RootLayout — Outlet renders nothing here.
	component: () => null,
})

const filePanelPopoutRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/popout/$dir/file-panel",
	component: FilePanelPopoutPage,
})

const routeTree = rootRoute.addChildren([
	indexRoute,
	workspaceRoute.addChildren([workspaceIndexRoute, sessionRoute]),
	settingsRoute,
	filePanelPopoutRoute,
])

export const router = createRouter({ routeTree })

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router
	}
}
