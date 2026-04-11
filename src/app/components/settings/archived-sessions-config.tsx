import { ChevronLeft, ChevronRight, Unarchive } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useEffect, useState } from "react"
import { apiClient } from "../../lib/api-client"
import { formatRelativeTime } from "../../lib/relative-time"
import { workspaceStoreRegistry } from "../../stores/workspace-store"
import { Tooltip } from "../ui/tooltip"

interface ArchivedSession {
	id: string
	title: string | null
	directory: string
	projectName: string
	archivedAt: number
	createdAt: number
	updatedAt: number
}

interface PaginatedResponse {
	items: ArchivedSession[]
	total: number
}

const PAGE_SIZE = 20

export function ArchivedSessionsConfig() {
	const [sessions, setSessions] = useState<ArchivedSession[]>([])
	const [total, setTotal] = useState(0)
	const [page, setPage] = useState(0)
	const [loading, setLoading] = useState(true)

	const fetchPage = useCallback((p: number) => {
		setLoading(true)
		apiClient
			.get<PaginatedResponse>(`/sessions/archived?limit=${PAGE_SIZE}&offset=${p * PAGE_SIZE}`)
			.then((res) => {
				setSessions(res.items)
				setTotal(res.total)
				setPage(p)
			})
			.catch((err) => console.error("[archived-sessions]", err))
			.finally(() => setLoading(false))
	}, [])

	useEffect(() => {
		fetchPage(0)
	}, [fetchPage])

	const totalPages = Math.ceil(total / PAGE_SIZE)

	const handleUnarchive = useCallback(
		(sessionId: string, directory: string) => {
			setSessions((prev) => prev.filter((s) => s.id !== sessionId))
			setTotal((prev) => prev - 1)
			apiClient
				.patch(`/sessions/${sessionId}`, { archivedAt: null }, { directory })
				.then((updated) => {
					// Directly update workspace store so unarchive doesn't depend solely on SSE.
					// SSE events can be lost (connection drop, store eviction) — this ensures
					// the session reappears in the sidebar reliably.
					const store = workspaceStoreRegistry.get(directory)
					if (!store) return
					const state = store.getState()
					if (state.sessions.some((s) => s.id === sessionId)) {
						state.updateSession(sessionId, updated as any)
					} else {
						state.addSession(updated as any)
					}
				})
				.catch((err) => {
					console.error("[unarchive]", err)
					// Rollback: server state unchanged, re-fetch to restore archived list
					fetchPage(page)
				})
		},
		[fetchPage, page],
	)

	return (
		<>
			<h1 className="mb-6 text-xl font-semibold text-foreground">Archived Sessions</h1>
			<div className="el-card">
				{loading ? (
					<div className="px-5 py-10 text-center text-sm text-muted">Loading...</div>
				) : sessions.length === 0 ? (
					<div className="px-5 py-10 text-center text-sm text-muted">No archived sessions.</div>
				) : (
					<div className="divide-y divide-[var(--separator)]">
						{sessions.map((session) => (
							<div key={session.id} className="flex items-center gap-3 px-5 py-3">
								<div className="min-w-0 flex-1">
									<div className="truncate text-sm text-foreground">
										{session.title ?? "Untitled"}
									</div>
									<div className="mt-0.5 text-xs text-muted">
										{session.projectName} &middot; Archived {formatRelativeTime(session.archivedAt)}
									</div>
								</div>
								<Tooltip content="Unarchive">
									<button
										type="button"
										className="el-surface-hover shrink-0 rounded-md p-1.5 text-muted transition-colors hover:text-foreground"
										onClick={() => handleUnarchive(session.id, session.directory)}
									>
										<Unarchive className="h-4 w-4" aria-hidden="true" />
									</button>
								</Tooltip>
							</div>
						))}
					</div>
				)}
			</div>
			{totalPages > 1 && (
				<div className="mt-4 flex items-center justify-between">
					<span className="text-xs text-muted">
						{page * PAGE_SIZE + 1}&ndash;{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
					</span>
					<div className="flex items-center gap-1">
						<button
							type="button"
							disabled={page === 0}
							className="rounded-md p-1 text-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
							onClick={() => fetchPage(page - 1)}
						>
							<ChevronLeft className="h-4 w-4" aria-hidden="true" />
						</button>
						<button
							type="button"
							disabled={page >= totalPages - 1}
							className="rounded-md p-1 text-muted transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
							onClick={() => fetchPage(page + 1)}
						>
							<ChevronRight className="h-4 w-4" aria-hidden="true" />
						</button>
					</div>
				</div>
			)}
		</>
	)
}
