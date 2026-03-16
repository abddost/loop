import { enableMapSet } from "immer"
import { type StoreApi, create } from "zustand"
import { immer } from "zustand/middleware/immer"

enableMapSet()

export interface Session {
	id: string
	title: string | null
	directory: string
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

export interface Question {
	id: string
	sessionId: string
	text: string
}

export interface WorkspaceState {
	directory: string
	sessions: Session[]
	activeSessionId: string | null
	messages: Map<string, MessageWithParts[]> // sessionId -> messages
	sessionStatus: Map<string, string> // sessionId -> status
	pendingPermissions: PermissionRequest[]
	pendingQuestions: Question[]
	vcsBranch: { branch: string; dirty: boolean } | null
	permissionMode: string

	// Actions
	initSessions(sessions: Session[]): void
	addSession(session: Session): void
	updateSession(id: string, data: Partial<Session>): void
	removeSession(id: string): void
	setActiveSession(id: string | null): void
	setMessages(sessionId: string, messages: MessageWithParts[]): void
	addMessage(sessionId: string, message: MessageWithParts): void
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
	setSessionStatus(sessionId: string, status: string): void
	addPermissionRequest(sessionId: string, request: PermissionRequest): void
	resolvePermission(callId: string): void
	addQuestion(sessionId: string, question: Question): void
	resolveQuestion(questionId: string): void
	initVcs(branch: { branch: string; dirty: boolean }): void
	setPermissionMode(mode: string): void
}

function createWorkspaceStore(directory: string) {
	return create<WorkspaceState>()(
		immer((set) => ({
			directory,
			sessions: [],
			activeSessionId: null,
			messages: new Map(),
			sessionStatus: new Map(),
			pendingPermissions: [],
			pendingQuestions: [],
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
					// Preserve any optimistic messages not yet in the server response.
					// This prevents a REST load from clearing a message the user just sent.
					const existing = s.messages.get(sessionId) ?? []
					const serverIds = new Set(messages.map((m) => m.id))
					const pending = existing.filter(
						(m) => m.id.startsWith("optimistic-") && !serverIds.has(m.id),
					)
					s.messages.set(sessionId, [...messages, ...pending])
				})
			},
			addMessage(sessionId, message) {
				set((s) => {
					const msgs = s.messages.get(sessionId) ?? []
					// Deduplicate: skip if a message with the same ID already exists.
					if (msgs.some((m) => m.id === message.id)) return
					// Reconcile optimistic messages: if a server-confirmed user message
					// arrives, replace the matching optimistic placeholder.
					if (message.role === "user") {
						const optimisticIdx = msgs.findIndex(
							(m) => m.id.startsWith("optimistic-") && m.role === "user",
						)
						if (optimisticIdx >= 0) {
							msgs[optimisticIdx] = message
							s.messages.set(sessionId, msgs)
							return
						}
					}
					msgs.push(message)
					s.messages.set(sessionId, msgs)
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
						// Replace existing part (or streaming placeholder) with final data.
						// The `streaming` flag is absent from server data, clearing it.
						msg.parts[idx] = part
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
			addPermissionRequest(_sessionId, request) {
				set((s) => {
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
		})),
	)
}

/** LRU registry for workspace stores */
class WorkspaceStoreRegistry {
	private stores = new Map<string, { store: StoreApi<WorkspaceState>; lastAccess: number }>()
	private maxStores = 30
	private ttlMs = 20 * 60 * 1000 // 20 minutes
	private cleanupInterval: ReturnType<typeof setInterval> | null = null

	constructor() {
		// Periodic cleanup of idle stores
		this.cleanupInterval = setInterval(() => this.evictExpired(), 60_000)
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
		if (oldest) this.stores.delete(oldest)
	}

	private evictExpired(): void {
		const now = Date.now()
		for (const [dir, entry] of this.stores) {
			if (now - entry.lastAccess > this.ttlMs) {
				this.stores.delete(dir)
			}
		}
	}

	dispose(): void {
		if (this.cleanupInterval) clearInterval(this.cleanupInterval)
		this.stores.clear()
	}
}

export const workspaceStoreRegistry = new WorkspaceStoreRegistry()
