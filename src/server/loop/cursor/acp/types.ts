/**
 * ACP (Agent Client Protocol) wire types.
 *
 * Subset of the open ACP schema (https://agentclientprotocol.com, v0.11.3)
 * that Loop's Cursor integration actually exchanges. Ported by hand from
 * t3code's effect-acp/_generated/schema.gen.ts so we don't pull the full
 * Effect Schema toolchain.
 *
 * ACP is bidirectional JSON-RPC 2.0 framed as newline-delimited JSON over
 * stdio. Cursor implements the agent side; we implement the client side.
 *
 * Wire layout:
 *   - Request:      { jsonrpc: "2.0", id, method, params? }
 *   - Notification: { jsonrpc: "2.0", method, params? }   (no id)
 *   - Response:     { jsonrpc: "2.0", id, result }
 *   - Error:        { jsonrpc: "2.0", id, error: {code, message, data?} }
 */

// ─── Capability negotiation ─────────────────────────────────────────

export interface ClientCapabilities {
	fs?: { readTextFile?: boolean; writeTextFile?: boolean }
	terminal?: boolean
	auth?: { methodIds?: string[] }
	elicitation?: Record<string, unknown>
	_meta?: Record<string, unknown>
}

export interface AgentCapabilities {
	auth?: { methodIds?: string[] }
	loadSession?: boolean
	mcpCapabilities?: Record<string, unknown>
	promptCapabilities?: Record<string, unknown>
	sessionCapabilities?: Record<string, unknown>
	_meta?: Record<string, unknown>
}

export interface InitializeRequest {
	protocolVersion: number
	clientCapabilities?: ClientCapabilities
	clientInfo: { name: string; version: string }
}

export interface InitializeResponse {
	protocolVersion: number
	agentCapabilities?: AgentCapabilities
	agentInfo?: { name?: string; version?: string }
	_meta?: Record<string, unknown>
}

export interface AuthenticateRequest {
	methodId: string
}

export type AuthenticateResponse = Record<string, unknown>

// ─── Sessions ────────────────────────────────────────────────────────

export interface McpServerStdio {
	type?: "stdio"
	name: string
	command: string
	args?: string[]
	env?: Array<{ name: string; value: string }>
}
export interface McpServerHttp {
	type: "http"
	name: string
	url: string
	headers?: Array<{ name: string; value: string }>
}
export interface McpServerSse {
	type: "sse"
	name: string
	url: string
	headers?: Array<{ name: string; value: string }>
}
export type McpServer = McpServerStdio | McpServerHttp | McpServerSse

export interface SessionConfigOptionValue {
	value: string
	displayName?: string | null
	description?: string | null
}

export interface SessionConfigOption {
	id: string
	displayName?: string | null
	description?: string | null
	type?: "string" | "boolean"
	category?: string | null
	currentValue?: string | boolean | null
	values?: ReadonlyArray<SessionConfigOptionValue>
}

export interface SessionMode {
	id: string
	displayName?: string | null
	description?: string | null
}

export interface SessionModeState {
	availableModes: ReadonlyArray<SessionMode>
	currentModeId?: string | null
}

export interface SessionModelInfo {
	id: string
	displayName?: string | null
	parameters?: Array<{
		id: string
		displayName?: string | null
		values: Array<{ value: string; displayName?: string | null }>
	}>
}

export interface SessionModelState {
	availableModels?: ReadonlyArray<SessionModelInfo>
	currentModelId?: string | null
}

export interface NewSessionRequest {
	cwd: string
	mcpServers: ReadonlyArray<McpServer>
	_meta?: Record<string, unknown>
}

export interface NewSessionResponse {
	sessionId: string
	configOptions?: ReadonlyArray<SessionConfigOption> | null
	modes?: SessionModeState | null
	models?: SessionModelState | null
	_meta?: Record<string, unknown>
}

export interface LoadSessionRequest {
	sessionId: string
	cwd: string
	mcpServers: ReadonlyArray<McpServer>
	_meta?: Record<string, unknown>
}

export interface LoadSessionResponse {
	configOptions?: ReadonlyArray<SessionConfigOption> | null
	modes?: SessionModeState | null
	models?: SessionModelState | null
	_meta?: Record<string, unknown>
}

export interface SetSessionModeRequest {
	sessionId: string
	modeId: string
}
export type SetSessionModeResponse = Record<string, unknown>

export type SetSessionConfigOptionRequest =
	| {
			sessionId: string
			configId: string
			value: string
			type?: undefined
			_meta?: Record<string, unknown>
	  }
	| {
			sessionId: string
			configId: string
			type: "boolean"
			value: boolean
			_meta?: Record<string, unknown>
	  }

export interface SetSessionConfigOptionResponse {
	configOptions?: ReadonlyArray<SessionConfigOption> | null
	_meta?: Record<string, unknown>
}

export interface CancelNotification {
	sessionId: string
}

// ─── Content blocks ──────────────────────────────────────────────────

export type ContentBlock =
	| {
			type: "text"
			text: string
			annotations?: Record<string, unknown> | null
			_meta?: Record<string, unknown>
	  }
	| {
			type: "image"
			data: string
			mimeType: string
			uri?: string | null
			annotations?: Record<string, unknown> | null
			_meta?: Record<string, unknown>
	  }
	| {
			type: "audio"
			data: string
			mimeType: string
			annotations?: Record<string, unknown> | null
			_meta?: Record<string, unknown>
	  }
	| {
			type: "resource_link"
			uri: string
			name: string
			description?: string | null
			mimeType?: string | null
			size?: number | null
			title?: string | null
			annotations?: Record<string, unknown> | null
			_meta?: Record<string, unknown>
	  }
	| {
			type: "resource"
			resource: {
				uri?: string
				mimeType?: string | null
				text?: string | null
				blob?: string | null
				_meta?: Record<string, unknown>
			}
			annotations?: Record<string, unknown> | null
			_meta?: Record<string, unknown>
	  }

// ─── Prompts ─────────────────────────────────────────────────────────

export interface PromptRequest {
	sessionId: string
	prompt: ReadonlyArray<ContentBlock>
	messageId?: string | null
	_meta?: Record<string, unknown>
}

export type StopReason = "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled"

export interface PromptResponse {
	stopReason: StopReason
	usage?: {
		input?: number
		output?: number
		cacheRead?: number
		cacheWrite?: number
		reasoning?: number
	} | null
	userMessageId?: string | null
	_meta?: Record<string, unknown>
}

// ─── Tool calls (server → client streaming) ──────────────────────────

export type ToolKind =
	| "read"
	| "edit"
	| "delete"
	| "move"
	| "search"
	| "execute"
	| "think"
	| "fetch"
	| "switch_mode"
	| "other"

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed"

export interface ToolCallLocation {
	path: string
	line?: number | null
}

export type ToolCallContent =
	| { type: "content"; content: ContentBlock }
	| {
			type: "diff"
			path: string
			oldText?: string | null
			newText: string
	  }
	| {
			type: "terminal"
			terminalId: string
	  }

export interface ToolCallSnapshot {
	toolCallId: string
	title: string
	kind?: ToolKind
	status?: ToolCallStatus
	content?: ReadonlyArray<ToolCallContent>
	locations?: ReadonlyArray<ToolCallLocation>
	rawInput?: unknown
	rawOutput?: unknown
	_meta?: Record<string, unknown>
}

export interface ToolCallUpdateSnapshot {
	toolCallId: string
	title?: string | null
	kind?: ToolKind | null
	status?: ToolCallStatus | null
	content?: ReadonlyArray<ToolCallContent> | null
	locations?: ReadonlyArray<ToolCallLocation> | null
	rawInput?: unknown
	rawOutput?: unknown
	_meta?: Record<string, unknown>
}

// ─── Plan / commands ─────────────────────────────────────────────────

export interface PlanEntry {
	content: string
	priority?: "high" | "medium" | "low"
	status?: "pending" | "in_progress" | "completed"
}

export interface AvailableCommand {
	name: string
	description?: string | null
	input?: { hint?: string | null } | null
}

// ─── Session/update streaming notification ───────────────────────────

export type SessionUpdateBody =
	| { sessionUpdate: "user_message_chunk"; content: ContentBlock; messageId?: string | null }
	| { sessionUpdate: "agent_message_chunk"; content: ContentBlock; messageId?: string | null }
	| { sessionUpdate: "agent_thought_chunk"; content: ContentBlock; messageId?: string | null }
	| ({ sessionUpdate: "tool_call" } & ToolCallSnapshot)
	| ({ sessionUpdate: "tool_call_update" } & ToolCallUpdateSnapshot)
	| { sessionUpdate: "plan"; entries: ReadonlyArray<PlanEntry> }
	| {
			sessionUpdate: "available_commands_update"
			availableCommands: ReadonlyArray<AvailableCommand>
	  }
	| { sessionUpdate: "current_mode_update"; currentModeId: string }
	| { sessionUpdate: "config_option_update"; configOptions: ReadonlyArray<SessionConfigOption> }
	| { sessionUpdate: "session_info_update"; title?: string | null; updatedAt?: string | null }
	| {
			sessionUpdate: "usage_update"
			used: number
			size: number
			cost?: { amount: number; currency: string } | null
	  }

export type SessionNotification = {
	sessionId: string
	update: SessionUpdateBody
	_meta?: Record<string, unknown>
}

// ─── Permission requests (client handles) ────────────────────────────

export type PermissionOptionKind = "allow_once" | "allow_always" | "reject_once" | "reject_always"

export interface PermissionOption {
	optionId: string
	name: string
	kind: PermissionOptionKind
	_meta?: Record<string, unknown>
}

export interface RequestPermissionRequest {
	sessionId: string
	options: ReadonlyArray<PermissionOption>
	toolCall: ToolCallUpdateSnapshot
	_meta?: Record<string, unknown>
}

export type PermissionOutcome = { outcome: "selected"; optionId: string } | { outcome: "cancelled" }

export interface RequestPermissionResponse {
	outcome: PermissionOutcome
	_meta?: Record<string, unknown>
}

// ─── FS callbacks (client implements) ────────────────────────────────

export interface ReadTextFileRequest {
	sessionId: string
	path: string
	line?: number | null
	limit?: number | null
}
export interface ReadTextFileResponse {
	content: string
	_meta?: Record<string, unknown>
}

export interface WriteTextFileRequest {
	sessionId: string
	path: string
	content: string
}
export type WriteTextFileResponse = Record<string, unknown>

// ─── Terminal callbacks (client implements) ──────────────────────────

export interface CreateTerminalRequest {
	sessionId: string
	command: string
	args?: ReadonlyArray<string>
	cwd?: string | null
	env?: ReadonlyArray<{ name: string; value: string }>
	outputByteLimit?: number | null
}
export interface CreateTerminalResponse {
	terminalId: string
	_meta?: Record<string, unknown>
}

export interface TerminalOutputRequest {
	sessionId: string
	terminalId: string
}
export interface TerminalExitStatus {
	exitCode?: number | null
	signal?: string | null
}
export interface TerminalOutputResponse {
	output: string
	truncated: boolean
	exitStatus?: TerminalExitStatus | null
	_meta?: Record<string, unknown>
}

export interface TerminalKillRequest {
	sessionId: string
	terminalId: string
}
export type TerminalKillResponse = Record<string, unknown>

export interface TerminalReleaseRequest {
	sessionId: string
	terminalId: string
}
export type TerminalReleaseResponse = Record<string, unknown>

export interface TerminalWaitForExitRequest {
	sessionId: string
	terminalId: string
}
export interface TerminalWaitForExitResponse {
	exitStatus?: TerminalExitStatus | null
	_meta?: Record<string, unknown>
}

// ─── Method names (constants for safety) ─────────────────────────────

export const ACP_METHODS = {
	// agent (request → agent, response from agent)
	initialize: "initialize",
	authenticate: "authenticate",
	logout: "logout",
	sessionNew: "session/new",
	sessionLoad: "session/load",
	sessionPrompt: "session/prompt",
	sessionSetMode: "session/set_mode",
	sessionSetConfigOption: "session/set_config_option",
	sessionSetModel: "session/set_model",

	// agent → client (notification: sessionId)
	sessionCancel: "session/cancel",

	// agent → client (notification, no id)
	sessionUpdate: "session/update",
	sessionElicitationComplete: "session/elicitation/complete",

	// agent → client (request, client implements)
	sessionRequestPermission: "session/request_permission",
	sessionElicitation: "session/elicitation",
	fsReadTextFile: "fs/read_text_file",
	fsWriteTextFile: "fs/write_text_file",
	terminalCreate: "terminal/create",
	terminalOutput: "terminal/output",
	terminalRelease: "terminal/release",
	terminalWaitForExit: "terminal/wait_for_exit",
	terminalKill: "terminal/kill",
} as const

// JSON-RPC envelope types

export interface JsonRpcRequest {
	jsonrpc: "2.0"
	id: number | string
	method: string
	params?: unknown
}
export interface JsonRpcNotification {
	jsonrpc: "2.0"
	method: string
	params?: unknown
}
export interface JsonRpcSuccess {
	jsonrpc: "2.0"
	id: number | string
	result: unknown
}
export interface JsonRpcError {
	jsonrpc: "2.0"
	id: number | string | null
	error: { code: number; message: string; data?: unknown }
}
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcError
