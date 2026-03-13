import { Workspace } from "../index"

/** Placeholder LSP manager — manages language server connections for a workspace. */
class LSPManager {
	constructor(readonly directory: string) {}
	async start(): Promise<void> {
		/* TODO */
	}
	async shutdown(): Promise<void> {
		/* TODO */
	}
}

/** Lazy-initialized LSP manager for the current workspace. */
export const lsp = Workspace.lazy(
	async () => {
		const manager = new LSPManager(Workspace.dir())
		await manager.start()
		return manager
	},
	async (m) => await m.shutdown(),
)
