import type { ToolPart } from "@core/schema"
import { type ComponentType, useEffect, useMemo, useRef, useState } from "react"
import { cn } from "../ui/cn"
import { DiffBlock, StatusIcon, ToolOutput, stripAnsi } from "./tool-output"

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
function normalizeTool(tool: string | undefined): string {
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
				"rounded-xl border border-border/60 bg-surface/40 backdrop-blur-sm transition-colors",
				expanded && "bg-surface/60",
				className,
			)}
		>
			<button
				type="button"
				className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors hover:bg-surface-hover/50 rounded-xl"
				onClick={() => setExpanded(!expanded)}
				aria-expanded={expanded}
			>
				<StatusIcon state={part.state} />
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
					<div className="space-y-2 border-t border-border/40 px-3.5 py-2.5">{children}</div>
				</div>
			</div>
		</div>
	)
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
	return (
		<svg
			width="12"
			height="12"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={cn(
				"shrink-0 text-muted transition-transform duration-200",
				expanded && "rotate-90",
			)}
			aria-hidden="true"
		>
			<polyline points="9 18 15 12 9 6" />
		</svg>
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
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			className="shrink-0 text-muted-foreground"
			aria-hidden="true"
		>
			<polyline points="4 17 10 11 4 5" />
			<line x1="12" y1="19" x2="20" y2="19" />
		</svg>
	)
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
		return stripAnsi(raw)
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
		if (active && outputRef.current) {
			outputRef.current.scrollTop = outputRef.current.scrollHeight
		}
	}, [active])

	const exitBadge =
		!active && exitCode != null ? (
			<span
				className={cn(
					"rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
					exitCode === 0 ? "bg-success/15 text-success" : "bg-error/15 text-error",
				)}
			>
				exit {exitCode}
			</span>
		) : undefined

	return (
		<div
			className={cn(
				"rounded-xl border border-border/60 bg-surface/40 backdrop-blur-sm transition-colors",
				expanded && "bg-surface/60",
				className,
			)}
		>
			{/* Header + description: single clickable area */}
			<button
				type="button"
				className="flex w-full flex-col px-3.5 py-2.5 text-left transition-colors hover:bg-surface-hover/50 rounded-xl"
				onClick={() => setExpanded(!expanded)}
				aria-expanded={expanded}
			>
				<div className="flex w-full items-center gap-2.5 text-sm">
					<TerminalIcon />
					<span
						className={cn(
							"min-w-0 flex-1 truncate font-mono text-xs",
							active ? "shimmer-text" : "text-foreground",
						)}
					>
						{commandDisplay}
					</span>
					{exitBadge}
					<ChevronIcon expanded={expanded} />
				</div>
				{description && (
					<div className="mt-1 pl-[22px] text-xs text-muted-foreground/60 truncate">
						{description}
					</div>
				)}
			</button>

			{/* Collapsible output */}
			<div
				className="grid transition-[grid-template-rows] duration-200 ease-out"
				style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
				aria-hidden={!expanded}
			>
				<div className="min-h-0 overflow-hidden">
					<div className="space-y-2 border-t border-border/40 px-3.5 py-2.5">
						{displayOutput && (
							<pre
								ref={outputRef}
								className={cn(
									"max-h-72 overflow-auto rounded-lg bg-background/80 p-2.5 text-xs text-muted-foreground font-mono",
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
					</div>
				</div>
			</div>
		</div>
	)
}

// ─── 2. Edit Tool ────────────────────────────────────────────────

function EditToolCall({ part, className }: { part: ToolPart; className?: string }) {
	const filePath = part.input?.path ? String(part.input.path) : ""
	const name = basename(filePath)
	const dir = dirname(filePath)
	const diff = metaStr(part, "diff")
	const additions = metaNum(part, "additions")
	const deletions = metaNum(part, "deletions")
	const active = isActive(part)

	return (
		<div
			className={cn("rounded-xl border border-border/60 bg-surface/40 backdrop-blur-sm", className)}
		>
			<FileMutationHeader
				part={part}
				icon="edit"
				name={name}
				dir={dir}
				additions={additions}
				deletions={deletions}
			/>
			{!active && diff && <CollapsibleDiff diff={diff} />}
			{part.error && (
				<div className="border-t border-border/40 px-3.5 py-2 text-xs text-error">{part.error}</div>
			)}
		</div>
	)
}

// ─── 3. Write Tool ───────────────────────────────────────────────

function WriteToolCall({ part, className }: { part: ToolPart; className?: string }) {
	const filePath = part.input?.path ? String(part.input.path) : ""
	const name = basename(filePath)
	const dir = dirname(filePath)
	const diff = metaStr(part, "diff")
	const additions = metaNum(part, "additions")
	const deletions = metaNum(part, "deletions")
	const writeType = metaStr(part, "type")
	const active = isActive(part)

	const typeBadge =
		!active && writeType ? (
			<span
				className={cn(
					"rounded-md px-1.5 py-0.5 text-[10px] font-medium",
					writeType === "create" ? "bg-success/15 text-success" : "bg-accent/15 text-accent",
				)}
			>
				{writeType === "create" ? "Created" : "Overwritten"}
			</span>
		) : undefined

	return (
		<div
			className={cn("rounded-xl border border-border/60 bg-surface/40 backdrop-blur-sm", className)}
		>
			<FileMutationHeader
				part={part}
				icon="write"
				name={name}
				dir={dir}
				additions={additions}
				deletions={deletions}
				badge={typeBadge}
			/>
			{!active && diff && <CollapsibleDiff diff={diff} />}
			{part.error && (
				<div className="border-t border-border/40 px-3.5 py-2 text-xs text-error">{part.error}</div>
			)}
		</div>
	)
}

// ─── 4. MultiEdit Tool ──────────────────────────────────────────

function MultiEditToolCall({ part, className }: { part: ToolPart; className?: string }) {
	const filePath = part.input?.path ? String(part.input.path) : ""
	const name = basename(filePath)
	const dir = dirname(filePath)
	const diff = metaStr(part, "diff")
	const additions = metaNum(part, "additions")
	const deletions = metaNum(part, "deletions")
	const editCount = metaNum(part, "editCount")
	const active = isActive(part)

	const editBadge =
		!active && editCount != null ? (
			<span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
				{editCount} edit{editCount !== 1 ? "s" : ""}
			</span>
		) : undefined

	return (
		<div
			className={cn("rounded-xl border border-border/60 bg-surface/40 backdrop-blur-sm", className)}
		>
			<FileMutationHeader
				part={part}
				icon="edit"
				name={name}
				dir={dir}
				additions={additions}
				deletions={deletions}
				badge={editBadge}
			/>
			{!active && diff && <CollapsibleDiff diff={diff} />}
			{part.error && (
				<div className="border-t border-border/40 px-3.5 py-2 text-xs text-error">{part.error}</div>
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

	const title = fileCount > 0 ? `Patch: ${fileCount} file${fileCount !== 1 ? "s" : ""}` : "Patch"

	return (
		<CollapsibleCard
			part={part}
			title={title}
			badge={<DiffStats additions={totalAdditions} deletions={totalDeletions} />}
			defaultExpanded={false}
			className={className}
		>
			<div className="space-y-1.5">
				{files.map((file) => (
					<PatchFileEntry key={file.path} file={file} />
				))}
			</div>
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
		<div className="rounded-lg border border-border/40 bg-background/40">
			<button
				type="button"
				className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-surface-hover/50 rounded-lg"
				onClick={() => setExpanded(!expanded)}
				aria-expanded={expanded}
			>
				<span className={cn("rounded px-1 py-0.5 text-[10px] font-medium", style.bg, style.text)}>
					{style.label}
				</span>
				<span className="min-w-0 flex-1 truncate font-mono text-foreground">{file.path}</span>
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
							<DiffBlock diff={file.diff} className="max-h-60" />
						</div>
					</div>
				</div>
			)}
		</div>
	)
}

// ─── 6. Batch Tool ───────────────────────────────────────────────

function BatchToolCall({ part, className }: { part: ToolPart; className?: string }) {
	const succeeded = metaNum(part, "succeeded") ?? 0
	const total = metaNum(part, "total") ?? 0
	const failed = metaNum(part, "failed") ?? 0

	const title = isActive(part)
		? `Batch: ${total} tool${total !== 1 ? "s" : ""}`
		: `Batch: ${succeeded}/${total} successful`

	const failBadge =
		failed > 0 ? (
			<span className="rounded-md bg-error/15 px-1.5 py-0.5 text-[10px] font-medium text-error">
				{failed} failed
			</span>
		) : undefined

	return (
		<CollapsibleCard
			part={part}
			title={title}
			badge={failBadge}
			defaultExpanded={false}
			className={className}
		>
			{part.output && <ToolOutput output={part.output} />}
			{part.error && (
				<div className="rounded-lg bg-error/10 p-2.5 text-xs text-error">{part.error}</div>
			)}
		</CollapsibleCard>
	)
}

// ─── 7. Read Tool (enhanced inline) ─────────────────────────────

function ReadToolCall({ part }: { part: ToolPart }) {
	const input = part.input
	const filePath = input?.path ?? input?.file_path
	if (!filePath) return <InlineLabel part={part} label="Read" />

	const file = basename(String(filePath))
	let label = `Read ${file}`
	if (input?.limit != null) {
		const start = (Number(input?.offset) || 0) + 1
		const end = start + Number(input?.limit) - 1
		label = `Read ${file} L${start}-${end}`
	}

	const hasMore = meta(part, "hasMore")
	const totalLines = metaNum(part, "totalLines")
	const truncationNote = hasMore && totalLines ? ` (${totalLines} lines total)` : ""

	return <InlineLabel part={part} label={label} suffix={truncationNote} />
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
		| Array<{ question: string; options?: Array<{ label: string }> }>
		| undefined
	const firstQuestion = questions?.[0]?.question ?? "Question"
	const title = firstQuestion.length > 60 ? `${firstQuestion.slice(0, 57)}...` : firstQuestion

	return (
		<CollapsibleCard
			part={part}
			title={title}
			defaultExpanded={isActive(part)}
			className={className}
		>
			{isActive(part) && (
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<StatusIcon state="running" className="h-3 w-3" />
					<span>Waiting for answer...</span>
				</div>
			)}
			{part.output && <ToolOutput output={part.output} />}
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
	const title = `Todo: ${done}/${total} completed`

	return (
		<CollapsibleCard part={part} title={title} defaultExpanded={false} className={className}>
			{todos && todos.length > 0 && (
				<div className="space-y-1">
					{todos.map((todo) => (
						<div key={todo.id} className="flex items-start gap-2 text-xs">
							<span className="mt-px shrink-0">
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
									todo.status === "done" && "line-through text-muted-foreground",
								)}
							>
								{todo.content}
							</span>
							<span
								className={cn(
									"shrink-0 rounded px-1 py-0.5 text-[10px] font-medium",
									todo.priority === "high" && "bg-error/15 text-error",
									todo.priority === "medium" && "bg-warning/15 text-warning",
									todo.priority === "low" && "bg-surface text-muted-foreground",
								)}
							>
								{todo.priority}
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
function CheckboxChecked() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			className="text-success"
			aria-hidden="true"
		>
			<rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
			<polyline
				points="7 12 10 15 17 9"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	)
}

function CheckboxPartial() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			className="text-accent"
			aria-hidden="true"
		>
			<rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
			<line
				x1="8"
				y1="12"
				x2="16"
				y2="12"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
			/>
		</svg>
	)
}

function CheckboxEmpty() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			className="text-muted-foreground"
			aria-hidden="true"
		>
			<rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
		</svg>
	)
}

// ─── 12. Task Tool ───────────────────────────────────────────────

function TaskToolCall({ part, className }: { part: ToolPart; className?: string }) {
	const description = part.input?.description ? String(part.input.description) : "Task"
	const agentType = part.input?.subagent_type ? String(part.input.subagent_type) : "build"
	const title = description.length > 60 ? `${description.slice(0, 57)}...` : description

	const agentBadge = (
		<span className="rounded-md bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
			{agentType}
		</span>
	)

	return (
		<CollapsibleCard
			part={part}
			title={title}
			badge={agentBadge}
			defaultExpanded={isActive(part)}
			className={className}
		>
			{isActive(part) && (
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<StatusIcon state="running" className="h-3 w-3" />
					<span>Running subagent...</span>
				</div>
			)}
			{part.output && <ToolOutput output={part.output} />}
			{part.error && (
				<div className="rounded-lg bg-error/10 p-2.5 text-xs text-error">{part.error}</div>
			)}
		</CollapsibleCard>
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

	return (
		<CollapsibleCard
			part={part}
			title={title}
			defaultExpanded={isActive(part)}
			className={className}
		>
			{isActive(part) && (
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<StatusIcon state="running" className="h-3 w-3" />
					<span>Waiting for confirmation...</span>
				</div>
			)}
			{part.output && <ToolOutput output={part.output} />}
		</CollapsibleCard>
	)
}

function PlanExitToolCall({ part, className }: { part: ToolPart; className?: string }) {
	const summary = part.input?.summary ? String(part.input.summary) : undefined
	const title = summary ? `Exit plan mode: ${summary.slice(0, 50)}` : "Exit plan mode"

	return (
		<CollapsibleCard
			part={part}
			title={title}
			defaultExpanded={isActive(part)}
			className={className}
		>
			{isActive(part) && (
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<StatusIcon state="running" className="h-3 w-3" />
					<span>Waiting for confirmation...</span>
				</div>
			)}
			{part.output && <ToolOutput output={part.output} />}
		</CollapsibleCard>
	)
}

// ─── List Tool (inline) ─────────────────────────────────────────

function ListToolCall({ part }: { part: ToolPart }) {
	const path = part.input?.path ? basename(String(part.input.path)) : ""
	const count = metaNum(part, "count")
	const label = `List ${path}`
	const suffix = count != null ? ` (${count} entries)` : ""

	return <InlineLabel part={part} label={label} suffix={suffix} />
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
	icon,
	name,
	dir,
	additions,
	deletions,
	badge,
}: {
	part: ToolPart
	icon: "edit" | "write"
	name: string
	dir: string
	additions?: number
	deletions?: number
	badge?: React.ReactNode
}) {
	const active = isActive(part)
	const iconLabel = icon === "write" ? "Write" : "Edit"

	return (
		<div className="flex items-center gap-2.5 px-3.5 py-2.5">
			<StatusIcon state={part.state} />
			<div className="min-w-0 flex-1">
				<span className={cn("text-sm", active ? "shimmer-text" : "text-foreground")}>
					{iconLabel} {name}
				</span>
				{dir && <span className="ml-1.5 text-xs text-muted-foreground/60 truncate">{dir}/</span>}
			</div>
			{badge}
			<DiffStats additions={additions} deletions={deletions} />
			{part.state === "error" && part.error && !additions && !deletions && (
				<span className="ml-auto truncate text-xs text-error">{part.error}</span>
			)}
		</div>
	)
}

// ─── Collapsible diff section ────────────────────────────────────

function CollapsibleDiff({ diff }: { diff: string }) {
	const [expanded, setExpanded] = useState(false)

	return (
		<div className="border-t border-border/40">
			<button
				type="button"
				className="flex w-full items-center gap-2 px-3.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-surface-hover/50"
				onClick={() => setExpanded(!expanded)}
				aria-expanded={expanded}
			>
				<ChevronIcon expanded={expanded} />
				<span>Show diff</span>
			</button>
			<div
				className="grid transition-[grid-template-rows] duration-200 ease-out"
				style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
				aria-hidden={!expanded}
			>
				<div className="min-h-0 overflow-hidden">
					<div className="px-3.5 pb-2.5">
						<DiffBlock diff={diff} />
					</div>
				</div>
			</div>
		</div>
	)
}

// ─── Default (fallback) Tool ─────────────────────────────────────

function DefaultToolCall({ part, className }: { part: ToolPart; className?: string }) {
	const title = part.tool

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
	edit: EditToolCall,
	write: WriteToolCall,
	multiedit: MultiEditToolCall,
	"apply-patch": ApplyPatchToolCall,
	batch: BatchToolCall,
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
	const Renderer = TOOL_REGISTRY[normalized]

	if (Renderer) {
		return <Renderer part={part} className={className} />
	}

	return <DefaultToolCall part={part} className={className} />
}
