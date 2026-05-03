import { createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router"
import { RootLayout } from "./routes/__root"
import { IndexPage } from "./routes/index-page"
import { FilePanelPopoutPage } from "./routes/popout/file-panel-page"
import { SessionPage } from "./routes/workspace/session-page"
import { WorkspaceLayout } from "./routes/workspace/workspace-layout"

const rootRoute = createRootRoute({
	component: RootLayout,
	// Any unmatched URL (stale deep-link, mistyped path, init-time race)
	// redirects to "/" instead of flashing TanStack Router's default 404
	// page. The IndexPage at "/" handles the rest of the routing.
	notFoundComponent: () => {
		throw redirect({ to: "/" })
	},
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

/** Settings tabs that can be deep-linked via `/settings?tab=<id>`. */
const SETTINGS_TABS = [
	"general",
	"providers",
	"models",
	"appearance",
	"keyboard",
	"mcp-servers",
	"skills",
	"archived",
] as const
export type SettingsTab = (typeof SETTINGS_TABS)[number]

const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings",
	validateSearch: (search: Record<string, unknown>): { tab?: SettingsTab } => {
		const tab = search.tab
		return typeof tab === "string" && (SETTINGS_TABS as readonly string[]).includes(tab)
			? { tab: tab as SettingsTab }
			: {}
	},
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
