import type { SessionStatus } from "@core/schema/session"
import { enableMapSet } from "immer"
import { type StoreApi, create } from "zustand"
import { immer } from "zustand/middleware/immer"

enableMapSet()

export interface Session {
	id: string
	title: string | null
	directory: string
	permissionMode?: string
	archivedAt: number | null
	createdAt: number
	updatedAt: number
}

export interface MessageWithParts {
	id: string
	sessionId: string
	role: "user" | "assistant"
	metadata?: any
	parts: any[]
	createdAt: number
}

export interface PermissionRequest {
	id: string
	sessionId: string
	tool: string
	input: Record<string, unknown>
	reason?: string
	type?: string
	/** The actual patterns being checked (for display). */
	patterns?: string[]
	/** Broader patterns for "always allow" option. */
	always?: string[]
}

export interface QuestionOption {
	label: string
	description?: string
}

export interface QuestionInfo {
	question: string
	options?: QuestionOption[]
	multiple?: boolean
}

export interface Question {
	id: string
	sessionId: string
	/** Source tool name (e.g. "question", "plan_enter") for filtering. */
	tool?: string
	/** Structured questions with options (question tool). */
	questions?: QuestionInfo[]
	/** Simple text fallback (plan tools, backward compat). */
	text?: string
}

export interface SessionUsage {
	input: number
	output: number
	reasoning?: number
	cacheRead?: number
	cacheWrite?: number
	cost: number
	contextWindow: number
}

export interface SessionError {
	severity: "error" | "warning"
	source: "runtime" | "auth" | "cli" | "rate-limit" | "tool" | "stream" | "provider"
	message: string
	details?: string
	recoverable?: boolean
	receivedAt: number
}

export interface WorkspaceState {
	directory: string
	sessions: Session[]
	activeSessionId: string | null
	messages: Map<string, MessageWithParts[]> // sessionId -> messages
	sessionStatus: Map<string, SessionStatus> // sessionId -> status
	sessionUsage: Map<string, SessionUsage> // sessionId -> accumulated usage
	childSessionIds: Set<string> // registered child sessions for SSE routing
	pendingPermissions: PermissionRequest[]
	pendingQuestions: Question[]
	sessionErrors: Map<string, SessionError> // sessionId -> latest error
	vcsBranch: { branch: string; dirty: boolean } | null
	permissionMode: string

	// Actions
	initSessions(sessions: Session[]): void
	addSession(session: Session): void
	/** Atomically add a new session and set it as active (single state update). */
	initNewSession(session: Session): void
	updateSession(id: string, data: Partial<Session>): void
	removeSession(id: string): void
	setActiveSession(id: string | null): void
	setMessages(sessionId: string, messages: MessageWithParts[]): void
	addMessage(sessionId: string, message: MessageWithParts): void
	removeMessage(sessionId: string, messageId: string): void
	upsertPart(sessionId: string, messageId: string, part: any): void
	/**
	 * Create a placeholder part for a new streaming delta.
	 * Called once when the first delta arrives for a partId.
	 * The placeholder is replaced by the full part on part:upsert.
	 * The actual streaming text is read from the StreamingBuffer, not this placeholder.
	 */
	createStreamingPart(
		sessionId: string,
		messageId: string,
		partId: string,
		partType?: "text" | "reasoning",
	): void
	setSessionStatus(sessionId: string, status: SessionStatus): void
	/**
	 * Reconcile client-side statuses against the server's snapshot.
	 * Any session currently non-idle on the client that is absent from
	 * `serverStatuses` is reset to "idle" — it became idle while the SSE
	 * connection was down and the idle event was lost.
	 */
	reconcileSessionStatuses(serverStatuses: Record<string, SessionStatus>): void
	setSessionUsage(sessionId: string, usage: SessionUsage): void
	registerChildSession(childSessionId: string): void
	unregisterChildSession(childSessionId: string): void
	addPermissionRequest(sessionId: string, request: PermissionRequest): void
	resolvePermission(callId: string): void
	addQuestion(sessionId: string, question: Question): void
	resolveQuestion(questionId: string): void
	initVcs(branch: { branch: string; dirty: boolean }): void
	setPermissionMode(mode: string): void
	setSessionError(sessionId: string, error: SessionError): void
	clearSessionError(sessionId: string): void
}

function createWorkspaceStore(directory: string) {
	return create<WorkspaceState>()(
		immer((set) => ({
			directory,
			sessions: [],
			activeSessionId: null,
			messages: new Map(),
			sessionStatus: new Map(),
			sessionUsage: new Map(),
			childSessionIds: new Set(),
			pendingPermissions: [],
			pendingQuestions: [],
			sessionErrors: new Map(),
			vcsBranch: null,
			permissionMode: "default",

			initSessions(sessions) {
				set((s) => {
					s.sessions = sessions
				})
			},
			addSession(session) {
				set((s) => {
					s.sessions.unshift(session)
				})
			},
			initNewSession(session) {
				set((s) => {
					s.sessions.unshift(session)
					s.activeSessionId = session.id
				})
			},
			updateSession(id, data) {
				set((s) => {
					const idx = s.sessions.findIndex((sess) => sess.id === id)
					if (idx >= 0) Object.assign(s.sessions[idx], data)
				})
			},
			removeSession(id) {
				set((s) => {
					s.sessions = s.sessions.filter((sess) => sess.id !== id)
					s.messages.delete(id)
				})
			},
			setActiveSession(id) {
				set((s) => {
					s.activeSessionId = id
				})
			},
			setMessages(sessionId, messages) {
				set((s) => {
					// Preserve any client-side messages not yet confirmed by the server.
					// The optimistic message shares the same ULID the server will use,
					// so once confirmed it merges naturally via the server response.
					const existing = s.messages.get(sessionId) ?? []
					const serverIds = new Set(messages.map((m) => m.id))
					const pending = existing.filter((m) => !serverIds.has(m.id))
					s.messages.set(sessionId, [...messages, ...pending])
				})
			},
			addMessage(sessionId, message) {
				set((s) => {
					const msgs = s.messages.get(sessionId) ?? []
					// Deduplicate: skip if a message with the same ID already exists.
					if (msgs.some((m) => m.id === message.id)) return
					msgs.push(message)
					s.messages.set(sessionId, msgs)
				})
			},
			removeMessage(sessionId, messageId) {
				set((s) => {
					const msgs = s.messages.get(sessionId)
					if (!msgs) return
					s.messages.set(
						sessionId,
						msgs.filter((m) => m.id !== messageId),
					)
				})
			},
			upsertPart(sessionId, messageId, part) {
				set((s) => {
					const msgs = s.messages.get(sessionId)
					if (!msgs) return
					const msg = msgs.find((m) => m.id === messageId)
					if (!msg) return
					const idx = msg.parts.findIndex((p: any) => p.id === part.id)
					if (idx >= 0) {
						// Strip the client-only `streaming` flag before merging server data.
						// Without this, the flag survives the spread and keeps components
						// reading from the (now-empty) streaming buffer.
						const { streaming: _, ...existing } = msg.parts[idx]
						msg.parts[idx] = { ...existing, ...part }
					} else {
						msg.parts.push(part)
					}
				})
			},
			createStreamingPart(sessionId, messageId, partId, partType) {
				set((s) => {
					const msgs = s.messages.get(sessionId)
					if (!msgs) return
					const msg = msgs.find((m) => m.id === messageId)
					if (!msg) return
					// Idempotent: skip if part already exists
					if (msg.parts.some((p: any) => p.id === partId)) return
					// Placeholder with empty text — actual content is in StreamingBuffer.
					// The `streaming` flag tells components to read from the buffer.
					msg.parts.push({ id: partId, type: partType ?? "text", text: "", streaming: true })
				})
			},
			setSessionStatus(sessionId, status) {
				set((s) => {
					s.sessionStatus.set(sessionId, status)
				})
			},
			reconcileSessionStatuses(serverStatuses) {
				set((s) => {
					for (const [sid, clientStatus] of s.sessionStatus.entries()) {
						if (clientStatus !== "idle" && !(sid in serverStatuses)) {
							s.sessionStatus.set(sid, "idle")
						}
					}
				})
			},
			setSessionUsage(sessionId, usage) {
				set((s) => {
					s.sessionUsage.set(sessionId, usage)
				})
			},
			registerChildSession(childSessionId) {
				set((s) => {
					s.childSessionIds.add(childSessionId)
				})
			},
			unregisterChildSession(childSessionId) {
				set((s) => {
					s.childSessionIds.delete(childSessionId)
					s.messages.delete(childSessionId)
					s.sessionStatus.delete(childSessionId)
				})
			},
			addPermissionRequest(_sessionId, request) {
				set((s) => {
					if (s.pendingPermissions.some((r) => r.id === request.id)) return
					s.pendingPermissions.push(request)
				})
			},
			resolvePermission(callId) {
				set((s) => {
					s.pendingPermissions = s.pendingPermissions.filter((r) => r.id !== callId)
				})
			},
			addQuestion(_sessionId, question) {
				set((s) => {
					if (s.pendingQuestions.some((q) => q.id === question.id)) return
					s.pendingQuestions.push(question)
				})
			},
			resolveQuestion(questionId) {
				set((s) => {
					s.pendingQuestions = s.pendingQuestions.filter((q) => q.id !== questionId)
				})
			},
			initVcs(branch) {
				set((s) => {
					s.vcsBranch = branch
				})
			},
			setPermissionMode(mode) {
				set((s) => {
					s.permissionMode = mode
				})
			},
			setSessionError(sessionId, error) {
				set((s) => {
					s.sessionErrors.set(sessionId, error)
				})
			},
			clearSessionError(sessionId) {
				set((s) => {
					s.sessionErrors.delete(sessionId)
				})
			},
		})),
	)
}

/** LRU registry for workspace stores */
class WorkspaceStoreRegistry {
	private stores = new Map<string, { store: StoreApi<WorkspaceState>; lastAccess: number }>()
	private maxStores = 30
	private ttlMs = 20 * 60 * 1000 // 20 minutes
	private cleanupInterval: ReturnType<typeof setInterval> | null = null

	/** Monotonically increasing counter — changes when stores are created or evicted. */
	private _version = 0
	private listeners = new Set<() => void>()

	constructor() {
		// Periodic cleanup of idle stores
		this.cleanupInterval = setInterval(() => this.evictExpired(), 60_000)
	}

	get version(): number {
		return this._version
	}

	/** Subscribe to registry changes (store creation/eviction). */
	subscribe = (cb: () => void): (() => void) => {
		this.listeners.add(cb)
		return () => this.listeners.delete(cb)
	}

	private notify(): void {
		this._version++
		for (const cb of this.listeners) cb()
	}

	getOrCreate(directory: string): StoreApi<WorkspaceState> {
		const entry = this.stores.get(directory)
		if (entry) {
			entry.lastAccess = Date.now()
			return entry.store
		}

		this.evictIfFull()
		const store = createWorkspaceStore(directory)
		this.stores.set(directory, { store, lastAccess: Date.now() })
		this.notify()
		return store
	}

	get(directory: string): StoreApi<WorkspaceState> | undefined {
		const entry = this.stores.get(directory)
		if (entry) entry.lastAccess = Date.now()
		return entry?.store
	}

	private evictIfFull(): void {
		if (this.stores.size < this.maxStores) return
		let oldest: string | undefined
		let oldestTime = Number.POSITIVE_INFINITY
		for (const [dir, entry] of this.stores) {
			if (entry.lastAccess < oldestTime) {
				oldestTime = entry.lastAccess
				oldest = dir
			}
		}
		if (oldest) {
			this.stores.delete(oldest)
			this.notify()
		}
	}

	private evictExpired(): void {
		const now = Date.now()
		let evicted = false
		for (const [dir, entry] of this.stores) {
			if (now - entry.lastAccess > this.ttlMs) {
				this.stores.delete(dir)
				evicted = true
			}
		}
		if (evicted) this.notify()
	}

	dispose(): void {
		if (this.cleanupInterval) clearInterval(this.cleanupInterval)
		this.stores.clear()
	}
}

export const workspaceStoreRegistry = new WorkspaceStoreRegistry()
