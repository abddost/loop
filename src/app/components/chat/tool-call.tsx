import type { ToolPart } from "@core/schema"
import {
	ArrowRight,
	CheckCircleFilled,
	ChevronRight,
	EmptyCircle,
	Terminal,
} from "@openai/apps-sdk-ui/components/Icon"
import { type ComponentType, useEffect, useMemo, useRef, useState } from "react"
import { useWorkspace } from "../../hooks/use-workspace"
import { apiClient } from "../../lib/api-client"
import { cn } from "../ui/cn"
import { FileIcon } from "./file-icon"
import { FileReference, renderTextWithFilePaths } from "./file-reference"
import { PlanApproval, PlanCard, PlanModeConfirmation } from "./plan-card"
import { DiffBlock, SpinningCircle, StatusIcon, ToolOutput, stripAnsi } from "./tool-output"

export interface ToolCallProps {
	part: ToolPart
	className?: string
}

// ─── Helpers ─────────────────────────────────────────────────────

function basename(path: string): string {
	return path.split("/").pop() ?? path
}

function dirname(path: string): string {
	const parts = path.split("/")
	if (parts.length <= 1) return ""
	parts.pop()
	return parts.join("/")
}

function isActive(part: ToolPart): boolean {
	return part.state === "running" || part.state === "pending"
}

/** Safely read a metadata field. */
function meta(part: ToolPart, key: string): unknown {
	return part.metadata?.[key]
}

/** Safely read a metadata field as a number. */
function metaNum(part: ToolPart, key: string): number | undefined {
	const v = meta(part, key)
	return typeof v === "number" ? v : undefined
}

/** Safely read a metadata field as a string. */
function metaStr(part: ToolPart, key: string): string | undefined {
	const v = meta(part, key)
	return typeof v === "string" ? v : undefined
}

/** Normalize tool name to lowercase for matching. */
export function normalizeTool(tool: string | undefined): string {
	if (!tool) return ""
	return tool
		.toLowerCase()
		.replace(/[_\s]/g, "-")
		.replace(/^(web)(fetch|search)$/, "web-$2")
		.replace(/^(list)(files)$/, "list")
		.replace(/^(apply)(patch)$/, "apply-patch")
}

// ─── Collapsible wrapper ─────────────────────────────────────────

interface CollapsibleCardProps {
	part: ToolPart
	title: React.ReactNode
	badge?: React.ReactNode
	defaultExpanded?: boolean
	children: React.ReactNode
	className?: string
}

function CollapsibleCard({
	part,
	title,
	badge,
	defaultExpanded,
	children,
	className,
}: CollapsibleCardProps) {
	const active = isActive(part)
	const [expanded, setExpanded] = useState(defaultExpanded ?? active)

	// Auto-expand when tool starts running, auto-collapse when done
	const prevState = useRef(part.state)
	useEffect(() => {
		if (prevState.current !== part.state) {
			if (part.state === "running") setExpanded(true)
			prevState.current = part.state
		}
	}, [part.state])

	return (
		<div
			className={cn(
				"el-card bg-surface/40 backdrop-blur-sm transition-colors",
				expanded && "bg-surface/60",
				className,
			)}
		>
			<button
				type="button"
				className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm rounded-xl"
				onClick={() => setExpanded(!expanded)}
				aria-expanded={expanded}
			>
				<span
					className={cn("min-w-0 flex-1 truncate", active ? "shimmer-text" : "text-foreground")}
				>
					{title}
				</span>
				{badge}
				<ChevronIcon expanded={expanded} />
			</button>
			<div
				className="grid transition-[grid-template-rows] duration-200 ease-out"
				style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
				aria-hidden={!expanded}
			>
				<div className="min-h-0 overflow-hidden">
					<div className="space-y-2 border-t border-[var(--separator)] px-3.5 py-2.5">
						{children}
					</div>
				</div>
			</div>
		</div>
	)
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
	return (
		<ChevronRight
			className={cn(
				"h-3 w-3 shrink-0 text-muted transition-transform duration-200",
				expanded && "rotate-90",
			)}
			aria-hidden="true"
		/>
	)
}

// ─── Diff stats badge ────────────────────────────────────────────

function DiffStats({ additions, deletions }: { additions?: number; deletions?: number }) {
	if (additions == null && deletions == null) return null
	return (
		<span className="ml-auto flex items-center gap-1.5 text-xs tabular-nums">
			{additions != null && additions > 0 && <span className="text-success">+{additions}</span>}
			{deletions != null && deletions > 0 && <span className="text-error">&minus;{deletions}</span>}
		</span>
	)
}

// ─── Terminal icon ────────────────────────────────────────────────

function TerminalIcon() {
	return <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
}

// ─── 1. Bash Tool ────────────────────────────────────────────────

function BashToolCall({ part, className }: { part: ToolPart; className?: string }) {
	const description = metaStr(part, "description")
	const command = part.input?.command ? String(part.input.command) : undefined
	const streamingOutput = metaStr(part, "output")
	const exitCode = metaNum(part, "exitCode")
	const active = isActive(part)

	const commandDisplay = command ? `$ ${command.split("\n")[0]}` : "$ bash"

	const displayOutput = useMemo(() => {
		const raw = active ? streamingOutput : part.output
		if (!raw) return undefined
		const cleaned = stripAnsi(raw)
		// Only detect file paths after tool completes (skip during streaming for perf)
		if (active) return cleaned
		return renderTextWithFilePaths(cleaned)
	}, [part, active, streamingOutput])

	const outputRef = useRef<HTMLPreElement>(null)
	const [expanded, setExpanded] = useState(active)

	// Auto-expand when tool starts running
	const prevState = useRef(part.state)
	useEffect(() => {
		if (prevState.current !== part.state) {
			if (part.state === "running") setExpanded(true)
			prevState.current = part.state
		}
	}, [part.state])

	// Auto-scroll output during streaming
	useEffect(() => {
		if (active && displayOutput && outputRef.current) {
			outputRef.current.scrollTop = outputRef.current.scrollHeight
		}
	}, [active, displayOutput])

	// Header shows the action description, falls back to command
	const headerText = description || commandDisplay

	return (
		<div
			className={cn(
				"rounded-xl bg-[color:var(--app-code-block)] shadow-[var(--shadow-outline)] backdrop-blur-sm transition-colors",
				className,
			)}
		>
			<button
				type="button"
				className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm rounded-xl"
				onClick={() => setExpanded(!expanded)}
				aria-expanded={expanded}
			>
				<TerminalIcon />
				<span
					className={cn("min-w-0 flex-1 truncate", active ? "shimmer-text" : "text-foreground")}
				>
					{headerText}
				</span>
				<ChevronIcon expanded={expanded} />
			</button>

			{/* Collapsible body: command + output + exit code */}
			<div
				className="grid transition-[grid-template-rows] duration-200 ease-out"
				style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
				aria-hidden={!expanded}
			>
				<div className="min-h-0 overflow-hidden">
					<div className="space-y-2 border-t border-[var(--separator)] px-3.5 py-2.5">
						{command && (
							<pre className="rounded-lg p-2.5 text-xs font-mono text-muted-foreground">
								<code>{commandDisplay}</code>
							</pre>
						)}
						{displayOutput && (
							<pre
								ref={outputRef}
								className={cn(
									"max-h-72 overflow-auto rounded-lg bg-[color:var(--app-segment-bg)] p-2.5 text-xs text-muted-foreground font-mono",
									"[&::-webkit-scrollbar]:w-1.5",
									"[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
								)}
							>
								<code>{displayOutput}</code>
							</pre>
						)}
						{part.error && (
							<div className="rounded-lg bg-error/10 p-2.5 text-xs text-error">{part.error}</div>
						)}
						{!active && exitCode != null && (
							<span
								className={cn(
									"text-[10px] tabular-nums",
									exitCode === 0 ? "text-muted-foreground" : "text-error",
								)}
							>
								exit {exitCode}
							</span>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}

// ─── 2. File Mutation (edit / write / multiedit) ─────────────────

function FileMutationToolCall({ part, className }: { part: ToolPart; className?: string }) {
	const filePath = part.input?.path ? String(part.input.path) : ""
	const name = basename(filePath)
	const dir = dirname(filePath)
	const diff = metaStr(part, "diff")
	const streamingOutput = metaStr(part, "output")
	const additions = metaNum(part, "additions")
	const deletions = metaNum(part, "deletions")
	const editCount = metaNum(part, "editCount")
	const active = isActive(part)
	const [expanded, setExpanded] = useState(false)
	const hasDiff = !active && !!diff

	const editBadge =
		!active && editCount != null ? (
			<span className="el-badge bg-accent/15 text-[10px] font-medium text-accent">
				{editCount} edit{editCount !== 1 ? "s" : ""}
			</span>
		) : undefined

	// Auto-scroll streaming output
	const streamRef = useRef<HTMLPreElement>(null)
	useEffect(() => {
		if (active && streamingOutput && streamRef.current) {
			streamRef.current.scrollTop = streamRef.current.scrollHeight
		}
	}, [active, streamingOutput])

	return (
		<div className={cn("el-card bg-surface/40 backdrop-blur-sm", className)}>
			<FileMutationHeader
				part={part}
				name={name}
				dir={dir}
				filePath={filePath}
				additions={additions}
				deletions={deletions}
				badge={editBadge}
				expanded={expanded}
				onToggle={hasDiff ? () => setExpanded(!expanded) : undefined}
			/>
			{/* Streaming output while running */}
			{active && streamingOutput && (
				<div className="border-t border-[var(--separator)] px-3.5 py-2.5">
					<pre
						ref={streamRef}
						className={cn(
							"max-h-60 overflow-auto rounded-lg bg-background/80 p-2.5 text-xs font-mono text-diff-add",
							"[&::-webkit-scrollbar]:w-1.5",
							"[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
						)}
					>
						<code>{streamingOutput}</code>
					</pre>
				</div>
			)}
			{/* Diff after completion */}
			{hasDiff && (
				<div
					className="grid transition-[grid-template-rows] duration-200 ease-out"
					style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
					aria-hidden={!expanded}
				>
					<div className="min-h-0 overflow-hidden">
						<div className="border-t border-[var(--separator)] px-1.5 py-1">
							<DiffBlock diff={diff} filePath={filePath} />
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

// ─── 5. Apply Patch Tool ─────────────────────────────────────────

interface PatchFileResult {
	path: string
	type: string
	diff: string
	additions: number
	deletions: number
}

function ApplyPatchToolCall({ part, className }: { part: ToolPart; className?: string }) {
	const files = (meta(part, "files") ?? []) as PatchFileResult[]
	const totalAdditions = metaNum(part, "totalAdditions")
	const totalDeletions = metaNum(part, "totalDeletions")
	const fileCount = files.length
	const active = isActive(part)

	const title = fileCount > 0 ? `Patch: ${fileCount} file${fileCount !== 1 ? "s" : ""}` : "Patch"

	return (
		<CollapsibleCard
			part={part}
			title={title}
			badge={
				!active ? <DiffStats additions={totalAdditions} deletions={totalDeletions} /> : undefined
			}
			defaultExpanded={active}
			className={className}
		>
			{active && files.length === 0 && (
				<div className="flex items-center gap-2 py-1 text-xs">
					<StatusIcon state="running" className="h-3 w-3" />
					<span className="shimmer-text">Applying patch across multiple files...</span>
				</div>
			)}
			{files.length > 0 && (
				<div className="space-y-1.5">
					{files.map((file) => (
						<PatchFileEntry key={file.path} file={file} />
					))}
				</div>
			)}
			{part.error && (
				<div className="rounded-lg bg-error/10 p-2.5 text-xs text-error">{part.error}</div>
			)}
		</CollapsibleCard>
	)
}

const PATCH_TYPE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
	add: { bg: "bg-success/15", text: "text-success", label: "Added" },
	update: { bg: "bg-accent/15", text: "text-accent", label: "Modified" },
	delete: { bg: "bg-error/15", text: "text-error", label: "Deleted" },
	move: { bg: "bg-warning/15", text: "text-warning", label: "Moved" },
}

function PatchFileEntry({ file }: { file: PatchFileResult }) {
	const [expanded, setExpanded] = useState(false)
	const style = PATCH_TYPE_STYLES[file.type] ?? PATCH_TYPE_STYLES.update

	return (
		<div className="rounded-lg bg-background/40 shadow-[var(--shadow-inset)]">
			<button
				type="button"
				className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-[var(--app-surface-hover)] rounded-lg"
				onClick={() => setExpanded(!expanded)}
				aria-expanded={expanded}
			>
				<span className={cn("el-badge text-[10px] font-medium", style.bg, style.text)}>
					{style.label}
				</span>
				<FileReference
					path={file.path}
					className="min-w-0 flex-1 truncate font-mono text-foreground"
				/>
				<DiffStats additions={file.additions} deletions={file.deletions} />
				<ChevronIcon expanded={expanded} />
			</button>
			{file.diff && (
				<div
					className="grid transition-[grid-template-rows] duration-200 ease-out"
					style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
					aria-hidden={!expanded}
				>
					<div className="min-h-0 overflow-hidden">
						<div className="border-t border-border/30 px-2.5 py-2">
							<DiffBlock diff={file.diff} filePath={file.path} className="max-h-60" />
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

// ─── 6. Batch Tool ───────────────────────────────────────────────
// Batch parent part is hidden — child tool parts render individually.
// See ToolCall entry point below for the filter.

// ─── 7. Read Tool (enhanced inline) ─────────────────────────────

function ReadToolCall({ part }: { part: ToolPart }) {
	const input = part.input
	const filePath = input?.path ?? input?.file_path
	if (!filePath) return <InlineLabel part={part} label="Read" />

	const pathStr = String(filePath)
	const file = basename(pathStr)
	const active = isActive(part)

	let lineInfo = ""
	let startLine: number | undefined
	if (input?.limit != null) {
		const start = (Number(input?.offset) || 0) + 1
		const end = start + Number(input?.limit) - 1
		lineInfo = ` L${start}-${end}`
		startLine = start
	}

	const hasMore = meta(part, "hasMore")
	const totalLines = metaNum(part, "totalLines")
	const truncationNote = hasMore && totalLines ? ` (${totalLines} lines total)` : ""

	return (
		<div className="py-0.5">
			<span
				className={cn(
					"text-sm",
					active ? "shimmer-text" : "text-muted-foreground",
					part.state === "error" && "text-error",
				)}
			>
				Read{" "}
				<FileReference
					path={pathStr}
					line={startLine}
					display={file}
					className={active ? "shimmer-text" : "text-muted-foreground"}
				/>
				{lineInfo}
			</span>
			{truncationNote && !active && (
				<span className="text-xs text-muted-foreground/70">{truncationNote}</span>
			)}
		</div>
	)
}

// ─── 8. Glob Tool (enhanced inline) ─────────────────────────────

function GlobToolCall({ part }: { part: ToolPart }) {
	const pattern = part.input?.pattern ? String(part.input.pattern) : ""
	const count = metaNum(part, "count")
	const totalCount = metaNum(part, "totalCount")
	const label = `Glob ${pattern}`
	const suffix =
		count != null
			? totalCount != null && totalCount > count
				? ` (${count}/${totalCount} shown)`
				: ` (${count} match${count !== 1 ? "es" : ""})`
			: ""

	return <InlineLabel part={part} label={label} suffix={suffix} />
}

// ─── 9. Grep Tool (enhanced inline) ─────────────────────────────

function GrepToolCall({ part }: { part: ToolPart }) {
	const pattern = part.input?.pattern ? String(part.input.pattern) : ""
	const matchCount = metaNum(part, "matchCount")
	const fileCount = metaNum(part, "fileCount")
	const label = `Grep "${pattern}"`
	const suffix =
		matchCount != null
			? fileCount != null
				? ` (${matchCount} match${matchCount !== 1 ? "es" : ""} in ${fileCount} file${fileCount !== 1 ? "s" : ""})`
				: ` (${matchCount} match${matchCount !== 1 ? "es" : ""})`
			: ""

	return <InlineLabel part={part} label={label} suffix={suffix} />
}

// ─── 10. Question Tool ──────────────────────────────────────────

function QuestionToolCall({ part, className }: { part: ToolPart; className?: string }) {
	const questions = part.input?.questions as
		| Array<{ question: string; options?: Array<{ label: string; description?: string }> }>
		| undefined
	const active = isActive(part)
	const firstQuestion = questions?.[0]?.question ?? "Question"

	return (
		<CollapsibleCard
			part={part}
			title={firstQuestion}
			defaultExpanded={active}
			className={className}
		>
			{active && (
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<StatusIcon state="running" className="h-3 w-3" />
					<span>Waiting for answer...</span>
				</div>
			)}

			{/* Show answered output */}
			{!active && part.output && (
				<div className="space-y-1.5">
					{questions && questions.length > 1 ? (
						<ToolOutput output={part.output} />
					) : (
						<div className="rounded-lg bg-success/10 px-2.5 py-1.5 text-xs text-success">
							{part.output}
						</div>
					)}
				</div>
			)}

			{part.error && (
				<div className="rounded-lg bg-error/10 p-2.5 text-xs text-error">{part.error}</div>
			)}
		</CollapsibleCard>
	)
}

// ─── 11. Todo Tool ───────────────────────────────────────────────

function TodoWriteToolCall({ part, className }: { part: ToolPart; className?: string }) {
	const todos = part.input?.todos as
		| Array<{ id: string; content: string; status: string; priority: string }>
		| undefined
	const total = todos?.length ?? 0
	const done = todos?.filter((t) => t.status === "done").length ?? 0
	const title = done > 0 ? `Todo: ${done}/${total} completed` : `Todo: ${total} tasks`

	return (
		<CollapsibleCard part={part} title={title} defaultExpanded={false} className={className}>
			{todos && todos.length > 0 && (
				<div className="space-y-1">
					{todos.map((todo) => (
						<div key={todo.id} className="flex items-center gap-2.5 py-0.5 text-xs">
							<span className="shrink-0">
								{todo.status === "done" ? (
									<CheckboxChecked />
								) : todo.status === "in-progress" ? (
									<CheckboxPartial />
								) : (
									<CheckboxEmpty />
								)}
							</span>
							<span
								className={cn(
									"min-w-0 flex-1",
									todo.status === "done" && "line-through text-muted-foreground/60",
								)}
							>
								{todo.content}
							</span>
						</div>
					))}
				</div>
			)}
			{part.error && (
				<div className="rounded-lg bg-error/10 p-2.5 text-xs text-error">{part.error}</div>
			)}
		</CollapsibleCard>
	)
}

function TodoReadToolCall({ part, className }: { part: ToolPart; className?: string }) {
	return (
		<CollapsibleCard part={part} title="Read todos" defaultExpanded={false} className={className}>
			{part.output && <ToolOutput output={part.output} />}
		</CollapsibleCard>
	)
}

// Checkbox icons for todos
export function CheckboxChecked() {
	return <CheckCircleFilled width="14" height="14" className="text-success" aria-hidden="true" />
}

export function CheckboxPartial() {
	return (
		<span
			className="flex h-[14px] w-[14px] items-center justify-center rounded-full bg-accent/20"
			aria-hidden="true"
		>
			<ArrowRight className="h-2.5 w-2.5 text-accent" />
		</span>
	)
}

export function CheckboxEmpty() {
	return (
		<EmptyCircle width="14" height="14" className="text-muted-foreground/40" aria-hidden="true" />
	)
}

// ─── 12. Task Tool ───────────────────────────────────────────────

interface SubToolCall {
	id: string
	tool: string
	state: "pending" | "running" | "completed" | "error"
	input?: Record<string, unknown>
	output?: string
	error?: string
	time: { start: number; end?: number }
}

/**
 * Render a single sub-tool call inline.
 * Mirrors the inline label pattern used by read/grep/glob.
 */
function SubToolItem({ subTool }: { subTool: SubToolCall }) {
	const active = subTool.state === "running" || subTool.state === "pending"
	const tool = subTool.tool

	// Build label based on tool type (mirrors main tool renderers)
	let label = tool
	let suffix = ""
	const input = subTool.input ?? {}

	switch (tool) {
		case "read": {
			const path = input.path ?? input.file_path
			label = `Read ${path ? basename(String(path)) : ""}`
			break
		}
		case "glob": {
			const pattern = input.pattern ? String(input.pattern) : ""
			label = `Glob ${pattern}`
			break
		}
		case "grep": {
			const pattern = input.pattern ? String(input.pattern) : ""
			label = `Grep "${pattern}"`
			break
		}
		case "list": {
			const path = input.path ? String(input.path) : ""
			label = `List ${path ? basename(path) : ""}`
			break
		}
		case "bash": {
			const cmd = input.command ? String(input.command).split("\n")[0] : ""
			label = cmd ? `$ ${cmd.length > 50 ? `${cmd.slice(0, 47)}...` : cmd}` : "$ bash"
			break
		}
		case "edit":
		case "multiedit": {
			const path = input.file_path ?? input.path
			label = `Edit ${path ? basename(String(path)) : ""}`
			break
		}
		case "write": {
			const path = input.file_path ?? input.path
			label = `Write ${path ? basename(String(path)) : ""}`
			break
		}
		case "web-fetch":
		case "webfetch": {
			try {
				const url = new URL(String(input.url ?? ""))
				label = `Fetch ${url.hostname}`
			} catch {
				label = "Fetch"
			}
			break
		}
		case "web-search":
		case "websearch": {
			const query = input.query ? String(input.query) : ""
			label = `Search "${query}"`
			break
		}
		default: {
			label = tool.charAt(0).toUpperCase() + tool.slice(1)
			break
		}
	}

	if (subTool.error) {
		suffix = " (error)"
	}

	return (
		<div className="flex items-center gap-2 py-0.5 min-w-0">
			<StatusIcon state={subTool.state} className="h-3 w-3 shrink-0" />
			<span
				className={cn(
					"text-xs min-w-0 truncate",
					active ? "shimmer-text" : "text-muted-foreground",
					subTool.state === "error" && "text-error",
				)}
			>
				{label}
			</span>
			{suffix && !active && (
				<span className="text-[10px] text-muted-foreground/60 shrink-0">{suffix}</span>
			)}
		</div>
	)
}

function TaskToolCall({ part, className }: { part: ToolPart; className?: string }) {
	const description = part.input?.description ? String(part.input.description) : "Task"
	const prompt = part.input?.prompt ? String(part.input.prompt) : ""
	const agentType = part.input?.subagent_type ? String(part.input.subagent_type) : "build"
	const active = isActive(part)
	const childSessionId = part.metadata?.childSessionId as string | undefined
	const { store } = useWorkspace()

	// Register child session for SSE routing + fetch initial messages on mount
	useEffect(() => {
		if (!childSessionId || !store) return

		const state = store.getState()
		state.registerChildSession(childSessionId)

		apiClient
			.get(`/sessions/${childSessionId}/messages`, { directory: state.directory })
			.then((msgs) => store.getState().setMessages(childSessionId, msgs as any[]))
			.catch((err) => console.error("[task:fetch]", err))

		return () => {
			store.getState().unregisterChildSession(childSessionId)
		}
	}, [childSessionId, store])

	// Read child session's messages via manual subscription (avoids useSyncExternalStore
	// infinite loop — `?? []` creates a new ref every snapshot when messages don't exist yet)
	const [childMessages, setChildMessages] = useState<any[]>([])

	useEffect(() => {
		if (!childSessionId || !store) return

		const current = store.getState().messages.get(childSessionId)
		if (current) setChildMessages(current)

		let prev = current
		const unsub = store.subscribe(() => {
			const next = store.getState().messages.get(childSessionId)
			if (next !== prev) {
				prev = next
				setChildMessages(next ?? [])
			}
		})
		return unsub
	}, [childSessionId, store])

	const childToolParts = useMemo(() => {
		if (!childMessages || childMessages.length === 0) return []
		return childMessages
			.filter((m: any) => m.role === "assistant")
			.flatMap((m: any) => m.parts ?? [])
			.filter((p: any) => p.type === "tool")
	}, [childMessages])

	// Legacy fallback: read from metadata.toolCalls (pre-migration task parts)
	const legacySubTools = useMemo(() => {
		if (childSessionId) return [] // New path — don't use legacy
		const raw = part.metadata?.toolCalls
		if (!Array.isArray(raw)) return []
		return raw as SubToolCall[]
	}, [childSessionId, part.metadata?.toolCalls])

	const toolCount = childSessionId ? childToolParts.length : legacySubTools.length

	// Truncate prompt for display
	const truncatedPrompt = prompt.length > 120 ? `${prompt.slice(0, 117)}...` : prompt

	// Collapsible state
	const [expanded, setExpanded] = useState(active)
	const prevState = useRef(part.state)
	useEffect(() => {
		if (prevState.current !== part.state) {
			if (part.state === "running") setExpanded(true)
			prevState.current = part.state
		}
	}, [part.state])

	return (
		<div
			className={cn(
				"el-card bg-surface/40 backdrop-blur-sm transition-colors",
				expanded && "bg-surface/60",
				className,
			)}
		>
			{/* Header */}
			<button
				type="button"
				className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm rounded-xl"
				onClick={() => setExpanded(!expanded)}
				aria-expanded={expanded}
			>
				<span
					className={cn("min-w-0 flex-1 truncate", active ? "shimmer-text" : "text-foreground")}
				>
					Spawned{" "}
					<span className="text-muted-foreground">
						{active ? "1 agent" : `${toolCount} tool${toolCount !== 1 ? "s" : ""}`}
					</span>
				</span>
				<ChevronIcon expanded={expanded} />
			</button>

			{/* Body */}
			<div
				className="grid transition-[grid-template-rows] duration-200 ease-out"
				style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
				aria-hidden={!expanded}
			>
				<div className="min-h-0 overflow-hidden">
					<div className="space-y-2 border-t border-[var(--separator)] px-3.5 py-2.5">
						{/* Instruction summary */}
						<p
							className={cn(
								"text-xs leading-relaxed",
								active ? "shimmer-text" : "text-muted-foreground",
							)}
						>
							Created <span className="font-medium text-accent">{description}</span>{" "}
							<span className="text-muted-foreground/70">({agentType})</span>
							{truncatedPrompt && (
								<>
									{" "}
									with the instructions:{" "}
									<span className="text-foreground/70">{truncatedPrompt}</span>
								</>
							)}
						</p>

						{/* Child session tool parts */}
						{childSessionId && childToolParts.length > 0 && (
							<div className="space-y-1">
								{childToolParts.map((toolPart: any) => (
									<ToolCall key={toolPart.id ?? toolPart.callId} part={toolPart} />
								))}
							</div>
						)}

						{/* Legacy path */}
						{!childSessionId && legacySubTools.length > 0 && (
							<div className="space-y-0.5">
								{legacySubTools.map((subTool) => (
									<SubToolItem key={subTool.id} subTool={subTool} />
								))}
							</div>
						)}

						{/* Error */}
						{part.error && (
							<div className="rounded-lg bg-error/10 p-2.5 text-xs text-error">{part.error}</div>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}

// ─── 13. Web Fetch Tool (enhanced inline) ────────────────────────

function WebFetchToolCall({ part }: { part: ToolPart }) {
	let label = "Fetch"
	if (part.input?.url) {
		try {
			const url = new URL(String(part.input.url))
			label = `Fetch ${url.hostname}`
		} catch {
			label = `Fetch ${String(part.input.url).slice(0, 40)}`
		}
	}

	const format =
		metaStr(part, "format") ?? (part.input?.format ? String(part.input.format) : undefined)
	const suffix = format ? ` (${format})` : ""

	return <InlineLabel part={part} label={label} suffix={suffix} />
}

// ─── 14. Web Search Tool (enhanced inline) ───────────────────────

function WebSearchToolCall({ part }: { part: ToolPart }) {
	const query = part.input?.query ? String(part.input.query) : ""
	const resultCount = metaNum(part, "resultCount")
	const label = `Search "${query}"`
	const suffix =
		resultCount != null ? ` (${resultCount} result${resultCount !== 1 ? "s" : ""})` : ""

	return <InlineLabel part={part} label={label} suffix={suffix} />
}

// ─── Plan Tools ──────────────────────────────────────────────────

function PlanEnterToolCall({ part, className }: { part: ToolPart; className?: string }) {
	const reason = part.input?.reason ? String(part.input.reason) : undefined
	const title = reason ? `Switch to plan mode: ${reason.slice(0, 50)}` : "Switch to plan mode"
	const active = isActive(part)

	return (
		<div className={cn("space-y-3", className)}>
			<CollapsibleCard part={part} title={title} defaultExpanded={active}>
				{active && (
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<StatusIcon state="running" className="h-3 w-3" />
						<span>Waiting for confirmation...</span>
					</div>
				)}
				{part.output && <ToolOutput output={part.output} />}
			</CollapsibleCard>
			{active && <PlanModeConfirmation />}
		</div>
	)
}

/**
 * Plan exit tool call.
 * Hides the tool call UI entirely — only renders the PlanCard + PlanApproval.
 * While waiting for plan content, shows a minimal loading state.
 */
function PlanExitToolCall({ part, className }: { part: ToolPart; className?: string }) {
	const planContent = metaStr(part, "planContent")
	const planPathStr = metaStr(part, "planPath")
	const active = isActive(part)

	// Plan content available — show card + approval
	if (planContent) {
		return (
			<div className={cn("space-y-3", className)}>
				<PlanCard content={planContent} planPath={planPathStr} />
				{active && <PlanApproval />}
			</div>
		)
	}

	// No plan content yet but tool is active — show loading + approval buttons
	// so the user can still respond even if metadata was lost (e.g. SSE reconnect)
	if (active) {
		return (
			<div className={cn("space-y-3", className)}>
				<div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
					<StatusIcon state="running" className="h-3 w-3" />
					<span className="shimmer-text">Preparing plan...</span>
				</div>
				<PlanApproval />
			</div>
		)
	}

	// Completed without plan content — nothing to show
	return null
}

/** Plan write tool: inline label showing plan was written. */
function PlanWriteToolCall({ part }: { part: ToolPart }) {
	const planPathStr = metaStr(part, "planPath")
	const label = planPathStr ? `Plan written to ${basename(planPathStr)}` : "Plan written"
	return <InlineLabel part={part} label={label} />
}

// ─── List Tool (inline) ─────────────────────────────────────────

function ListToolCall({ part }: { part: ToolPart }) {
	const pathStr = part.input?.path ? String(part.input.path) : ""
	if (!pathStr) return <InlineLabel part={part} label="List" />

	const active = isActive(part)
	return (
		<div className="py-0.5">
			<span
				className={cn(
					"text-sm",
					active ? "shimmer-text" : "text-muted-foreground",
					part.state === "error" && "text-error",
				)}
			>
				List{" "}
				<FileReference
					path={pathStr}
					display={basename(pathStr)}
					className={active ? "shimmer-text" : "text-muted-foreground"}
				/>
			</span>
		</div>
	)
}

// ─── Shared inline label ─────────────────────────────────────────

function InlineLabel({
	part,
	label,
	suffix,
}: {
	part: ToolPart
	label: string
	suffix?: string
}) {
	const active = isActive(part)
	return (
		<div className="py-0.5">
			<span
				className={cn(
					"text-sm",
					active ? "shimmer-text" : "text-muted-foreground",
					part.state === "error" && "text-error",
				)}
			>
				{label}
			</span>
			{suffix && !active && <span className="text-xs text-muted-foreground/70">{suffix}</span>}
		</div>
	)
}

// ─── Shared file mutation header ─────────────────────────────────

function FileMutationHeader({
	part,
	name,
	dir,
	filePath,
	additions,
	deletions,
	badge,
	expanded,
	onToggle,
}: {
	part: ToolPart
	name: string
	dir: string
	filePath: string
	additions?: number
	deletions?: number
	badge?: React.ReactNode
	expanded?: boolean
	onToggle?: () => void
}) {
	const active = isActive(part)

	return (
		<button
			type="button"
			className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left rounded-xl"
			onClick={onToggle}
			aria-expanded={expanded}
		>
			{active && <SpinningCircle className="shrink-0" />}
			<FileIcon filePath={filePath || name} size={16} />
			<div className="flex min-w-0 flex-1 items-center gap-1.5">
				<span
					className={cn(
						"text-sm font-medium truncate",
						active ? "shimmer-text" : "text-foreground",
					)}
				>
					<FileReference
						path={dir ? `${dir}/${name}` : name}
						display={name}
						className={active ? "shimmer-text" : "text-foreground"}
					/>
				</span>
				{dir && <span className="text-xs text-muted-foreground/60 truncate">{dir}/</span>}
			</div>
			{badge}
			{!active && <DiffStats additions={additions} deletions={deletions} />}
			{part.state === "error" && part.error && !additions && !deletions && (
				<span className="ml-auto truncate text-xs text-error">{part.error}</span>
			)}
			{onToggle && <ChevronIcon expanded={expanded ?? false} />}
		</button>
	)
}

// ─── Default (fallback) Tool ─────────────────────────────────────

function DefaultToolCall({ part, className }: { part: ToolPart; className?: string }) {
	const title = part.tool || "Unknown tool"

	return (
		<CollapsibleCard part={part} title={title} defaultExpanded={false} className={className}>
			{part.input && (
				<pre className="max-h-48 overflow-auto rounded-lg bg-background/80 p-2.5 text-xs text-muted-foreground font-mono">
					<code>{JSON.stringify(part.input, null, 2)}</code>
				</pre>
			)}
			{part.output && <ToolOutput output={part.output} />}
			{part.error && (
				<div className="rounded-lg bg-error/10 p-2.5 text-xs text-error">{part.error}</div>
			)}
		</CollapsibleCard>
	)
}

// ─── Tool renderer registry ──────────────────────────────────────

type ToolRenderer = ComponentType<{ part: ToolPart; className?: string }>

const TOOL_REGISTRY: Record<string, ToolRenderer> = {
	bash: BashToolCall,
	edit: FileMutationToolCall,
	write: FileMutationToolCall,
	multiedit: FileMutationToolCall,
	"apply-patch": ApplyPatchToolCall,
	// batch: hidden — child tool parts render individually
	read: ReadToolCall,
	glob: GlobToolCall,
	grep: GrepToolCall,
	question: QuestionToolCall,
	todowrite: TodoWriteToolCall,
	todoread: TodoReadToolCall,
	task: TaskToolCall,
	"web-fetch": WebFetchToolCall,
	"web-search": WebSearchToolCall,
	list: ListToolCall,
	"plan-enter": PlanEnterToolCall,
	"plan-exit": PlanExitToolCall,
	"plan-write": PlanWriteToolCall,
}

// ─── Entry point ─────────────────────────────────────────────────

/**
 * Renders a tool call part using specialized renderers from a registry.
 * Falls back to DefaultToolCall for unregistered tools.
 *
 * Tool categories:
 * - Inline: read/glob/grep/web-fetch/web-search/list (compact text)
 * - File mutation: write/edit/multiedit/apply-patch (card with diff)
 * - Collapsible: bash/batch/task/question/todo/plan (expandable card)
 * - Default: raw JSON input/output in collapsible card
 */
export function ToolCall({ part, className }: ToolCallProps) {
	const normalized = normalizeTool(part.tool)

	// Batch parent part is hidden — children render individually
	if (normalized === "batch") return null

	const Renderer = TOOL_REGISTRY[normalized]

	if (Renderer) {
		return <Renderer part={part} className={className} />
	}

	return <DefaultToolCall part={part} className={className} />
}
