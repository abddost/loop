import type { ToolPart } from "@core/schema"
import { useState } from "react"
import { cn } from "../ui/cn"
import { ToolOutput } from "./tool-output"

export interface ToolCallProps {
	part: ToolPart
	className?: string
}

// ─── Tool categories ─────────────────────────────────────────────

const INLINE_TOOLS = new Set([
	"read",
	"Read",
	"glob",
	"Glob",
	"grep",
	"Grep",
	"search",
	"Search",
	"web_fetch",
	"WebFetch",
	"web-fetch",
	"web_search",
	"WebSearch",
	"web-search",
	"list_files",
	"ListFiles",
])

const FILE_MUTATION_TOOLS = new Set([
	"write",
	"Write",
	"edit",
	"Edit",
	"patch",
	"Patch",
	"MultiEdit",
])

// ─── Helpers ─────────────────────────────────────────────────────

function basename(path: string): string {
	return path.split("/").pop() ?? path
}

function getInlineLabel(part: ToolPart): string {
	const input = part.input

	switch (part.tool.toLowerCase()) {
		case "read": {
			const filePath = input?.path ?? input?.file_path
			if (!filePath) return "Read"
			const file = basename(String(filePath))
			if (input?.limit != null) {
				const start = (Number(input?.offset) || 0) + 1
				const end = start + Number(input?.limit) - 1
				return `Read ${file} L${start}-${end}`
			}
			return `Read ${file}`
		}
		case "glob":
			return `Glob ${input?.pattern ? String(input.pattern) : ""}`
		case "grep":
			return `Grep "${input?.pattern ? String(input.pattern) : ""}"`
		case "web_fetch":
		case "webfetch":
		case "web-fetch":
			if (input?.url) {
				try {
					const url = new URL(String(input.url))
					return `Fetch ${url.hostname}`
				} catch {
					return `Fetch ${String(input.url).slice(0, 40)}`
				}
			}
			return "Fetch"
		case "web_search":
		case "websearch":
		case "web-search":
		case "search":
			return `Search "${input?.query ? String(input.query) : ""}"`
		case "list_files":
		case "listfiles":
			return `List ${input?.path ? basename(String(input.path)) : ""}`
		default:
			return part.tool
	}
}

function getFileMutationLabel(part: ToolPart): string {
	const input = part.input
	const name = part.tool.charAt(0).toUpperCase() + part.tool.slice(1)
	const filePath = input?.path ?? input?.file_path
	if (filePath) return `${name} ${basename(String(filePath))}`
	return name
}

function getLineStats(part: ToolPart): { added?: number; removed?: number } | null {
	if (part.state !== "completed") return null
	const input = part.input
	if (!input) return null

	const tool = part.tool.toLowerCase()
	if (tool === "edit" || tool === "multiedit") {
		const oldStr = typeof input.old_string === "string" ? input.old_string : ""
		const newStr = typeof input.new_string === "string" ? input.new_string : ""
		if (!oldStr && !newStr) return null
		return {
			removed: oldStr ? oldStr.split("\n").length : undefined,
			added: newStr ? newStr.split("\n").length : undefined,
		}
	}
	if (tool === "write") {
		const content = typeof input.content === "string" ? input.content : ""
		if (!content) return null
		return { added: content.split("\n").length }
	}
	return null
}

function getDefaultToolTitle(part: ToolPart): string {
	if (part.tool === "bash" && part.input?.command) {
		const cmd = String(part.input.command).split("\n")[0].slice(0, 60)
		return `bash: ${cmd}`
	}
	return part.tool
}

// ─── Shared icons ────────────────────────────────────────────────

function CircularProgress({ className }: { className?: string }) {
	return (
		<svg
			className={cn("h-4 w-4 animate-spin", className)}
			viewBox="0 0 24 24"
			fill="none"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="10" stroke="var(--border)" strokeWidth="2.5" />
			<circle
				cx="12"
				cy="12"
				r="10"
				stroke="var(--accent)"
				strokeWidth="2.5"
				strokeDasharray="62.83"
				strokeDashoffset="47.12"
				strokeLinecap="round"
			/>
		</svg>
	)
}

function CheckIcon({ className }: { className?: string }) {
	return (
		<svg
			className={cn("h-4 w-4 text-success", className)}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<polyline points="20 6 9 17 4 12" />
		</svg>
	)
}

function ErrorIcon({ className }: { className?: string }) {
	return (
		<svg
			className={cn("h-4 w-4 text-error", className)}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</svg>
	)
}

// ─── Inline tool (read/search/grep/glob/fetch) ──────────────────

function InlineToolCall({ part }: { part: ToolPart }) {
	const label = getInlineLabel(part)
	const isActive = part.state === "running" || part.state === "pending"

	return (
		<div className="py-0.5">
			<span
				className={cn(
					"text-sm",
					isActive ? "shimmer-text" : "text-muted-foreground",
					part.state === "error" && "text-error",
				)}
			>
				{label}
			</span>
		</div>
	)
}

// ─── File mutation tool (write/edit/patch) ───────────────────────

function FileMutationToolCall({ part, className }: { part: ToolPart; className?: string }) {
	const label = getFileMutationLabel(part)
	const isActive = part.state === "running" || part.state === "pending"
	const stats = getLineStats(part)

	return (
		<div className={cn("flex items-center gap-2.5 py-0.5", className)}>
			{isActive ? <CircularProgress /> : part.state === "completed" ? <CheckIcon /> : <ErrorIcon />}
			<span className={cn("text-sm", isActive ? "shimmer-text" : "text-foreground")}>{label}</span>
			{stats && (
				<span className="ml-auto flex items-center gap-1.5 text-xs tabular-nums">
					{stats.added != null && <span className="text-success">+{stats.added}</span>}
					{stats.removed != null && <span className="text-error">&minus;{stats.removed}</span>}
				</span>
			)}
			{part.state === "error" && part.error && (
				<span className="ml-auto truncate text-xs text-error">{part.error}</span>
			)}
		</div>
	)
}

// ─── Default tool (bash, etc.) ───────────────────────────────────

function DefaultToolCall({ part, className }: { part: ToolPart; className?: string }) {
	const [expanded, setExpanded] = useState(false)
	const title = getDefaultToolTitle(part)
	const isActive = part.state === "running" || part.state === "pending"

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
			>
				{isActive ? (
					<CircularProgress className="h-3.5 w-3.5" />
				) : part.state === "completed" ? (
					<CheckIcon className="h-3.5 w-3.5" />
				) : (
					<ErrorIcon className="h-3.5 w-3.5" />
				)}
				<span
					className={cn("min-w-0 flex-1 truncate", isActive ? "shimmer-text" : "text-foreground")}
				>
					{title}
				</span>
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
			</button>
			<div
				className="grid transition-[grid-template-rows] duration-200 ease-out"
				style={{ gridTemplateRows: expanded ? "1fr" : "0fr" }}
			>
				<div className="min-h-0 overflow-hidden">
					<div className="space-y-2 border-t border-border/40 px-3.5 py-2.5">
						{part.input && (
							<pre className="max-h-48 overflow-auto rounded-lg bg-background/80 p-2.5 text-xs text-muted-foreground">
								<code>{JSON.stringify(part.input, null, 2)}</code>
							</pre>
						)}
						{part.output && <ToolOutput output={part.output} />}
						{part.error && (
							<div className="rounded-lg bg-error/10 p-2.5 text-xs text-error">{part.error}</div>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}

// ─── Entry point ─────────────────────────────────────────────────

/**
 * Renders a tool call part with display style based on tool category:
 * - Read/search tools: inline text with shimmer during execution
 * - File mutation tools: card with circular progress + line stats
 * - Other tools: collapsible card with input/output
 */
export function ToolCall({ part, className }: ToolCallProps) {
	if (INLINE_TOOLS.has(part.tool)) return <InlineToolCall part={part} />
	if (FILE_MUTATION_TOOLS.has(part.tool))
		return <FileMutationToolCall part={part} className={className} />
	return <DefaultToolCall part={part} className={className} />
}
