import type { McpServerConfig, McpServerInfo } from "@core/schema/mcp"
import { Plus, Reload, Trash, X } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useRef, useState } from "react"
import { useMcpStore } from "../../stores/mcp-store"
import { cn } from "../ui/cn"

type ServerType = "stdio" | "http"

interface ListItem {
	_id: number
	value: string
}

interface KVItem {
	_id: number
	key: string
	value: string
}

interface StdioFormState {
	command: string
	args: ListItem[]
	env: KVItem[]
	envPassthrough: ListItem[]
	cwd: string
}

interface HttpFormState {
	url: string
	bearerTokenEnvVar: string
	headers: KVItem[]
	headersFromEnv: KVItem[]
}

const EMPTY_STDIO: StdioFormState = {
	command: "",
	args: [],
	env: [],
	envPassthrough: [],
	cwd: "",
}

const EMPTY_HTTP: HttpFormState = {
	url: "",
	bearerTokenEnvVar: "",
	headers: [],
	headersFromEnv: [],
}

/**
 * MCP servers settings tab.
 * Manages server connections and provides an inline form for adding new servers.
 */
export function McpConfig({ className }: { className?: string }) {
	const servers = useMcpStore((s) => s.servers)
	const [showAddForm, setShowAddForm] = useState(false)

	const handleRestartAll = useCallback(async () => {
		try {
			await useMcpStore.getState().restartAll()
		} catch (err) {
			console.error("[mcp:restart-all]", err)
		}
	}, [])

	const handleCloseForm = useCallback(() => {
		setShowAddForm(false)
	}, [])

	return (
		<div className={className}>
			{/* Header */}
			<div className="mb-6 flex items-center justify-between">
				<div>
					<h1 className="text-xl font-semibold text-foreground">MCP Servers</h1>
					<p className="mt-1 text-xs text-muted">Connect external tools and data sources.</p>
				</div>
				<button
					type="button"
					onClick={handleRestartAll}
					className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
				>
					<Reload className="h-3 w-3" aria-hidden="true" />
					<span>Restart</span>
				</button>
			</div>

			{/* Custom servers section */}
			<h2 className="mb-4 text-base font-semibold text-foreground">Custom servers</h2>

			{servers.length === 0 && !showAddForm && (
				<div className="rounded-xl border border-border px-5 py-10 text-center">
					<p className="text-sm text-muted">No custom MCP servers connected</p>
					<button
						type="button"
						onClick={() => setShowAddForm(true)}
						className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
					>
						<Plus className="h-3 w-3" aria-hidden="true" />
						<span>Add server</span>
					</button>
				</div>
			)}

			{servers.length > 0 && (
				<div className="rounded-xl border border-border">
					<div className="divide-y divide-border">
						{servers.map((server) => (
							<ServerRow key={server.name} server={server} />
						))}
					</div>
					{!showAddForm && (
						<button
							type="button"
							onClick={() => setShowAddForm(true)}
							className="flex w-full items-center justify-center gap-1.5 border-t border-border px-5 py-2.5 text-xs text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
						>
							<Plus className="h-3 w-3" aria-hidden="true" />
							<span>Add server</span>
						</button>
					)}
				</div>
			)}

			{/* Add server form */}
			{showAddForm && <AddServerForm onClose={handleCloseForm} />}
		</div>
	)
}

// ── Status dot color mapping ──────────────────────────────────

function statusColor(status: McpServerInfo["status"]): string {
	switch (status) {
		case "connected":
			return "bg-green-500"
		case "connecting":
			return "bg-yellow-500"
		case "failed":
			return "bg-red-500"
		case "disconnected":
			return "bg-zinc-500"
	}
}

// ── Server row ────────────────────────────────────────────────

function ServerRow({ server }: { server: McpServerInfo }) {
	const isConnected = server.status === "connected"
	const isConnecting = server.status === "connecting"

	const handleToggle = useCallback(async () => {
		try {
			if (isConnected || isConnecting) {
				await useMcpStore.getState().disconnectServer(server.name)
			} else {
				await useMcpStore.getState().connectServer(server.name)
			}
		} catch (err) {
			console.error("[mcp:toggle]", err)
		}
	}, [server.name, isConnected, isConnecting])

	const handleDelete = useCallback(async () => {
		try {
			await useMcpStore.getState().removeServer(server.name)
		} catch (err) {
			console.error("[mcp:delete]", err)
		}
	}, [server.name])

	return (
		<div className="flex items-center justify-between px-5 py-3">
			<div className="flex min-w-0 items-center gap-3">
				<span className={cn("h-2 w-2 shrink-0 rounded-full", statusColor(server.status))} />
				<div className="min-w-0">
					<div className="flex items-center gap-2">
						<span className="truncate text-sm font-medium text-foreground">{server.name}</span>
						<span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted">
							{server.config.type}
						</span>
						{server.toolCount > 0 && (
							<span className="text-[11px] text-muted">
								{server.toolCount} tool{server.toolCount !== 1 ? "s" : ""}
							</span>
						)}
					</div>
					{server.error && (
						<p className="mt-0.5 truncate text-[11px] text-red-500">{server.error}</p>
					)}
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<ToggleSwitch checked={isConnected || isConnecting} onChange={handleToggle} />
				<button
					type="button"
					onClick={handleDelete}
					className="rounded-md p-1 text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
					aria-label={`Delete ${server.name}`}
				>
					<Trash className="h-3.5 w-3.5" aria-hidden="true" />
				</button>
			</div>
		</div>
	)
}

// ── Toggle switch (matches models-config.tsx) ─────────────────

function ToggleSwitch({
	checked,
	onChange,
}: {
	checked: boolean
	onChange: () => void
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			onClick={onChange}
			className={cn(
				"relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
				checked ? "bg-accent" : "bg-default",
			)}
		>
			<span
				className={cn(
					"inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
					checked ? "translate-x-[18px]" : "translate-x-[2px]",
				)}
			/>
		</button>
	)
}

// ── Add server form ───────────────────────────────────────────

function AddServerForm({ onClose }: { onClose: () => void }) {
	const [name, setName] = useState("")
	const [serverType, setServerType] = useState<ServerType>("stdio")
	const [stdio, setStdio] = useState<StdioFormState>(EMPTY_STDIO)
	const [http, setHttp] = useState<HttpFormState>(EMPTY_HTTP)
	const [saving, setSaving] = useState(false)
	const idRef = useRef(0)
	const nextId = useCallback(() => ++idRef.current, [])

	const handleSave = useCallback(async () => {
		if (!name.trim()) return

		let config: McpServerConfig
		if (serverType === "stdio") {
			if (!stdio.command.trim()) return
			const filteredArgs = stdio.args.filter((a) => a.value.trim()).map((a) => a.value)
			const filteredEnv = stdio.env.filter((e) => e.key.trim())
			const filteredPassthrough = stdio.envPassthrough
				.filter((v) => v.value.trim())
				.map((v) => v.value)
			config = {
				type: "stdio",
				command: stdio.command.trim(),
				args: filteredArgs,
				...(filteredEnv.length > 0 && {
					env: Object.fromEntries(filteredEnv.map((e) => [e.key, e.value])),
				}),
				...(filteredPassthrough.length > 0 && { envPassthrough: filteredPassthrough }),
				...(stdio.cwd.trim() && { cwd: stdio.cwd.trim() }),
				enabled: true,
			}
		} else {
			if (!http.url.trim()) return
			const filteredHeaders = http.headers.filter((h) => h.key.trim())
			const filteredHeadersEnv = http.headersFromEnv.filter((h) => h.key.trim())
			config = {
				type: "http",
				url: http.url.trim(),
				...(http.bearerTokenEnvVar.trim() && {
					bearerTokenEnvVar: http.bearerTokenEnvVar.trim(),
				}),
				...(filteredHeaders.length > 0 && {
					headers: Object.fromEntries(filteredHeaders.map((h) => [h.key, h.value])),
				}),
				...(filteredHeadersEnv.length > 0 && {
					headersFromEnv: Object.fromEntries(filteredHeadersEnv.map((h) => [h.key, h.value])),
				}),
				enabled: true,
			}
		}

		setSaving(true)
		try {
			await useMcpStore.getState().addServer(name.trim(), config)
			onClose()
		} catch (err) {
			console.error("[mcp:add-server]", err)
		} finally {
			setSaving(false)
		}
	}, [name, serverType, stdio, http, onClose])

	return (
		<div className="mt-4 rounded-xl border border-border">
			{/* Form header */}
			<div className="flex items-center justify-between border-b border-border px-5 py-3">
				<span className="text-sm font-semibold text-foreground">Add server</span>
				<button
					type="button"
					onClick={onClose}
					className="rounded-md p-1 text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
					aria-label="Close"
				>
					<X className="h-4 w-4" aria-hidden="true" />
				</button>
			</div>

			<div className="space-y-4 px-5 py-4">
				{/* Name */}
				<FormField label="Name">
					<input
						type="text"
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="my-server"
						className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-placeholder outline-none transition-colors focus:border-accent"
					/>
				</FormField>

				{/* Type toggle */}
				<FormField label="Transport">
					<TypeSegment value={serverType} onChange={setServerType} />
				</FormField>

				{/* STDIO fields */}
				{serverType === "stdio" && (
					<StdioFields state={stdio} onChange={setStdio} nextId={nextId} />
				)}

				{/* HTTP fields */}
				{serverType === "http" && <HttpFields state={http} onChange={setHttp} nextId={nextId} />}
			</div>

			{/* Save button */}
			<div className="border-t border-border px-5 py-3">
				<button
					type="button"
					onClick={handleSave}
					disabled={saving}
					className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
				>
					{saving ? "Saving..." : "Save"}
				</button>
			</div>
		</div>
	)
}

// ── Form field wrapper ────────────────────────────────────────

function FormField({
	label,
	children,
}: {
	label: string
	children: React.ReactNode
}) {
	return (
		<div>
			<div className="mb-1.5 text-xs font-medium text-muted">{label}</div>
			{children}
		</div>
	)
}

// ── Type segmented control (matches ThemeSegment) ─────────────

function TypeSegment({
	value,
	onChange,
}: {
	value: ServerType
	onChange: (value: ServerType) => void
}) {
	const options: { id: ServerType; label: string }[] = [
		{ id: "stdio", label: "STDIO" },
		{ id: "http", label: "Streamable HTTP" },
	]

	return (
		<div className="flex rounded-lg border border-border bg-segment-bg">
			{options.map((opt) => (
				<button
					key={opt.id}
					type="button"
					onClick={() => onChange(opt.id)}
					className={cn(
						"flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
						value === opt.id
							? "bg-surface-hover text-foreground"
							: "text-muted hover:text-foreground",
					)}
				>
					<span>{opt.label}</span>
				</button>
			))}
		</div>
	)
}

// ── STDIO form fields ─────────────────────────────────────────

function StdioFields({
	state,
	onChange,
	nextId,
}: {
	state: StdioFormState
	onChange: (state: StdioFormState) => void
	nextId: () => number
}) {
	return (
		<>
			{/* Command */}
			<FormField label="Command to launch">
				<input
					type="text"
					value={state.command}
					onChange={(e) => onChange({ ...state, command: e.target.value })}
					placeholder="npx -y @modelcontextprotocol/server"
					className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-placeholder outline-none transition-colors focus:border-accent"
				/>
			</FormField>

			{/* Arguments */}
			<FormField label="Arguments">
				<ListEditor
					items={state.args}
					onChange={(args) => onChange({ ...state, args })}
					placeholder="Argument value"
					nextId={nextId}
				/>
			</FormField>

			{/* Environment variables */}
			<FormField label="Environment variables">
				<KeyValueEditor
					items={state.env}
					onChange={(env) => onChange({ ...state, env })}
					keyPlaceholder="Variable name"
					valuePlaceholder="Value"
					nextId={nextId}
				/>
			</FormField>

			{/* Environment variable passthrough */}
			<FormField label="Environment variable passthrough">
				<ListEditor
					items={state.envPassthrough}
					onChange={(envPassthrough) => onChange({ ...state, envPassthrough })}
					placeholder="Variable name"
					nextId={nextId}
				/>
			</FormField>

			{/* Working directory */}
			<FormField label="Working directory">
				<input
					type="text"
					value={state.cwd}
					onChange={(e) => onChange({ ...state, cwd: e.target.value })}
					placeholder="/path/to/working/directory"
					className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-placeholder outline-none transition-colors focus:border-accent"
				/>
			</FormField>
		</>
	)
}

// ── HTTP form fields ──────────────────────────────────────────

function HttpFields({
	state,
	onChange,
	nextId,
}: {
	state: HttpFormState
	onChange: (state: HttpFormState) => void
	nextId: () => number
}) {
	return (
		<>
			{/* URL */}
			<FormField label="URL">
				<input
					type="text"
					value={state.url}
					onChange={(e) => onChange({ ...state, url: e.target.value })}
					placeholder="https://example.com/mcp"
					className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-placeholder outline-none transition-colors focus:border-accent"
				/>
			</FormField>

			{/* Bearer token env var */}
			<FormField label="Bearer token env var">
				<input
					type="text"
					value={state.bearerTokenEnvVar}
					onChange={(e) => onChange({ ...state, bearerTokenEnvVar: e.target.value })}
					placeholder="MCP_BEARER_TOKEN"
					className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-placeholder outline-none transition-colors focus:border-accent"
				/>
			</FormField>

			{/* Headers */}
			<FormField label="Headers">
				<KeyValueEditor
					items={state.headers}
					onChange={(headers) => onChange({ ...state, headers })}
					keyPlaceholder="Header name"
					valuePlaceholder="Header value"
					nextId={nextId}
				/>
			</FormField>

			{/* Headers from env */}
			<FormField label="Headers from env vars">
				<KeyValueEditor
					items={state.headersFromEnv}
					onChange={(headersFromEnv) => onChange({ ...state, headersFromEnv })}
					keyPlaceholder="Header name"
					valuePlaceholder="Env var name"
					nextId={nextId}
				/>
			</FormField>
		</>
	)
}

// ── List editor (for args, envPassthrough) ────────────────────

function ListEditor({
	items,
	onChange,
	placeholder,
	nextId,
}: {
	items: ListItem[]
	onChange: (items: ListItem[]) => void
	placeholder: string
	nextId: () => number
}) {
	const handleAdd = () => onChange([...items, { _id: nextId(), value: "" }])
	const handleRemove = (id: number) => onChange(items.filter((item) => item._id !== id))
	const handleChange = (id: number, value: string) =>
		onChange(items.map((item) => (item._id === id ? { ...item, value } : item)))

	return (
		<div className="space-y-2">
			{items.map((item) => (
				<div key={item._id} className="flex items-center gap-2">
					<input
						type="text"
						value={item.value}
						onChange={(e) => handleChange(item._id, e.target.value)}
						placeholder={placeholder}
						className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-placeholder outline-none transition-colors focus:border-accent"
					/>
					<button
						type="button"
						onClick={() => handleRemove(item._id)}
						className="rounded-md p-1 text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
						aria-label="Remove"
					>
						<X className="h-3.5 w-3.5" aria-hidden="true" />
					</button>
				</div>
			))}
			<button
				type="button"
				onClick={handleAdd}
				className="flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
			>
				<Plus className="h-3 w-3" aria-hidden="true" />
				<span>Add</span>
			</button>
		</div>
	)
}

// ── Key-value editor (for env, headers) ───────────────────────

function KeyValueEditor({
	items,
	onChange,
	keyPlaceholder,
	valuePlaceholder,
	nextId,
}: {
	items: KVItem[]
	onChange: (items: KVItem[]) => void
	keyPlaceholder: string
	valuePlaceholder: string
	nextId: () => number
}) {
	const handleAdd = () => onChange([...items, { _id: nextId(), key: "", value: "" }])
	const handleRemove = (id: number) => onChange(items.filter((item) => item._id !== id))
	const handleKeyChange = (id: number, key: string) =>
		onChange(items.map((item) => (item._id === id ? { ...item, key } : item)))
	const handleValueChange = (id: number, value: string) =>
		onChange(items.map((item) => (item._id === id ? { ...item, value } : item)))

	return (
		<div className="space-y-2">
			{items.map((item) => (
				<div key={item._id} className="flex items-center gap-2">
					<input
						type="text"
						value={item.key}
						onChange={(e) => handleKeyChange(item._id, e.target.value)}
						placeholder={keyPlaceholder}
						className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-placeholder outline-none transition-colors focus:border-accent"
					/>
					<input
						type="text"
						value={item.value}
						onChange={(e) => handleValueChange(item._id, e.target.value)}
						placeholder={valuePlaceholder}
						className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-placeholder outline-none transition-colors focus:border-accent"
					/>
					<button
						type="button"
						onClick={() => handleRemove(item._id)}
						className="rounded-md p-1 text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
						aria-label="Remove"
					>
						<X className="h-3.5 w-3.5" aria-hidden="true" />
					</button>
				</div>
			))}
			<button
				type="button"
				onClick={handleAdd}
				className="flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
			>
				<Plus className="h-3 w-3" aria-hidden="true" />
				<span>Add</span>
			</button>
		</div>
	)
}
