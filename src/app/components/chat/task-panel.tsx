import type { ToolPart } from "@core/schema"
import { useEffect, useMemo, useRef, useState } from "react"
import { useActiveSession } from "../../hooks/use-session"
import { useTaskPanelStore } from "../../stores/task-panel-store"
import { cn } from "../ui/cn"

/**
 * Right-side panel for Claude Code background subagents — sourced from
 * tool parts with `tool === "Subagent"` emitted by the claude-code adapter
 * from `task_started` / `task_progress` / `task_notification`.
 *
 * Two-zone layout:
 *   - Detail header: only when a task is focused (click-through from list)
 *   - List: every subagent in the active session, most recent first
 *
 * The chat timeline does not render these parts inline — the panel is the
 * single canonical place for subagent progress.
 */
export function TaskPanel() {
	const panelOpen = useTaskPanelStore((s) => s.panelOpen)
	const focusedTaskId = useTaskPanelStore((s) => s.focusedTaskId)
	const setPanelOpen = useTaskPanelStore((s) => s.setPanelOpen)
	const focusTask = useTaskPanelStore((s) => s.focusTask)
	const { messages } = useActiveSession()

	const tasks = useMemo(() => {
		const collected: ToolPart[] = []
		for (const msg of messages as Array<{ role: string; parts?: unknown[] }>) {
			if (msg.role !== "assistant" || !Array.isArray(msg.parts)) continue
			for (const p of msg.parts) {
				if (!p || typeof p !== "object") continue
				const part = p as ToolPart
				if (part.type === "tool" && part.tool === "Subagent") {
					collected.push(part)
				}
			}
		}
		return collected.reverse()
	}, [messages])

	const focused = useMemo(
		() => (focusedTaskId ? tasks.find((t) => t.callId === focusedTaskId) : undefined),
		[focusedTaskId, tasks],
	)

	const scrollRef = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!focusedTaskId || !scrollRef.current) return
		const el = scrollRef.current.querySelector<HTMLDivElement>(
			`[data-task-id="${CSS.escape(focusedTaskId)}"]`,
		)
		el?.scrollIntoView({ behavior: "smooth", block: "nearest" })
	}, [focusedTaskId])

	if (!panelOpen) return null

	const running = tasks.filter((t) => t.state === "running" || t.state === "pending").length
	const completed = tasks.filter((t) => t.state === "completed").length
	const failed = tasks.filter((t) => t.state === "error").length

	return (
		<div className="flex h-full flex-col bg-surface">
			<PanelHeader
				total={tasks.length}
				running={running}
				completed={completed}
				failed={failed}
				onClose={() => setPanelOpen(false)}
			/>

			{focused && <FocusedHeader task={focused} onDismiss={() => focusTask(undefined)} />}

			<div ref={scrollRef} className="flex-1 overflow-y-auto">
				{tasks.length === 0 ? (
					<EmptyState />
				) : (
					<ul className="flex flex-col gap-1.5 p-3">
						{tasks.map((task) => (
							<TaskRow
								key={task.callId}
								task={task}
								focused={focusedTaskId === task.callId}
								onClick={() => focusTask(focusedTaskId === task.callId ? undefined : task.callId)}
							/>
						))}
					</ul>
				)}
			</div>
		</div>
	)
}

// ─── Header ──────────────────────────────────────────────────────────

function PanelHeader({
	total,
	running,
	completed,
	failed,
	onClose,
}: {
	total: number
	running: number
	completed: number
	failed: number
	onClose: () => void
}) {
	return (
		<header className="flex items-center justify-between border-b border-border/50 px-4 py-3">
			<div className="flex min-w-0 flex-col gap-0.5">
				<div className="text-[13px] font-medium tracking-tight text-foreground">
					Tasks &amp; Agents
				</div>
				<div className="flex items-center gap-2 text-[10px] tabular-nums text-muted-foreground">
					{total === 0 ? (
						<span>No activity in this session</span>
					) : (
						<>
							<Stat count={running} label="active" tone="accent" pulse={running > 0} />
							<Dot />
							<Stat count={completed} label="done" tone="success" />
							{failed > 0 && (
								<>
									<Dot />
									<Stat count={failed} label="failed" tone="error" />
								</>
							)}
						</>
					)}
				</div>
			</div>
			<button
				type="button"
				onClick={onClose}
				className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/15 hover:text-foreground"
				aria-label="Close panel"
			>
				<CloseIcon />
			</button>
		</header>
	)
}

function Stat({
	count,
	label,
	tone,
	pulse,
}: {
	count: number
	label: string
	tone: "accent" | "success" | "error"
	pulse?: boolean
}) {
	const dotClass = tone === "success" ? "bg-success" : tone === "error" ? "bg-error" : "bg-accent"
	return (
		<span className="flex items-center gap-1">
			<span className={cn("h-1.5 w-1.5 rounded-full", dotClass, pulse && "animate-pulse")} />
			<span className="text-foreground">{count}</span>
			<span>{label}</span>
		</span>
	)
}

function Dot() {
	return <span className="text-border">·</span>
}

// ─── Focused detail ──────────────────────────────────────────────────

function FocusedHeader({ task, onDismiss }: { task: ToolPart; onDismiss: () => void }) {
	const description = (task.input?.description as string | undefined) ?? "Background subagent"
	const taskType = (task.input?.task_type as string | undefined) ?? undefined
	const taskId = (task.input?.task_id as string | undefined) ?? task.callId
	const toolUseId = task.input?.tool_use_id as string | undefined
	const usage = readUsage(task)
	const lastToolName =
		typeof task.metadata?.lastToolName === "string" ? task.metadata.lastToolName : undefined
	const outputFile =
		typeof task.metadata?.outputFile === "string" ? task.metadata.outputFile : undefined
	const summary = typeof task.metadata?.summary === "string" ? task.metadata.summary : undefined
	const startedAt = task.time?.start
	const endedAt = task.time?.end

	return (
		<section className="border-b border-border/50 bg-background/30 px-4 py-4">
			<div className="flex items-start gap-3">
				<AgentAvatar taskType={taskType} state={task.state} />
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h3 className="min-w-0 truncate text-sm font-semibold text-foreground">
							{description}
						</h3>
						<StateBadge state={task.state} />
					</div>
					<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] tabular-nums text-muted-foreground">
						{taskType && <MonoKey label="kind" value={taskType} />}
						<MonoKey label="task" value={taskId.slice(0, 8)} />
						{toolUseId && <MonoKey label="caller" value={toolUseId.slice(0, 8)} />}
					</div>
				</div>
				<button
					type="button"
					onClick={onDismiss}
					className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent/15 hover:text-foreground"
					aria-label="Dismiss focus"
				>
					<CloseIcon />
				</button>
			</div>

			<MetricsRow
				usage={usage}
				startedAt={startedAt}
				endedAt={endedAt}
				running={task.state === "running" || task.state === "pending"}
			/>

			{lastToolName && (task.state === "running" || task.state === "pending") && (
				<div className="mt-3 flex items-center gap-1.5 rounded-lg border border-border/40 bg-surface/60 px-2.5 py-1.5 text-xs text-muted-foreground">
					<SpinnerDot />
					<span>
						Running <span className="font-mono text-foreground">{lastToolName}</span>
					</span>
				</div>
			)}

			{summary && (
				<div className="mt-3 whitespace-pre-wrap rounded-lg border border-border/40 bg-surface/60 p-3 text-[12px] leading-relaxed text-foreground">
					{summary}
				</div>
			)}

			{outputFile && (
				<div className="mt-2 text-[11px] text-muted-foreground">
					<span className="text-muted-foreground/80">Output →</span>{" "}
					<span className="font-mono text-foreground/90">{outputFile}</span>
				</div>
			)}

			{task.error && (
				<div className="mt-3 whitespace-pre-wrap rounded-lg border border-error/40 bg-error/10 p-3 text-[12px] leading-relaxed text-error">
					{task.error}
				</div>
			)}
		</section>
	)
}

function MonoKey({ label, value }: { label: string; value: string }) {
	return (
		<span className="inline-flex items-center gap-1">
			<span className="uppercase text-muted-foreground/70">{label}</span>
			<span className="font-mono text-foreground/80">{value}</span>
		</span>
	)
}

function AgentAvatar({ taskType, state }: { taskType?: string; state: string }) {
	const letter = (taskType ?? "agent").charAt(0).toUpperCase()
	const running = state === "running" || state === "pending"
	return (
		<div className="relative">
			<div
				className={cn(
					"flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-sm font-semibold tracking-tight transition-colors",
					running
						? "border-accent/60 bg-accent/20 text-accent"
						: state === "error"
							? "border-error/40 bg-error/10 text-error"
							: "border-border/50 bg-surface text-foreground",
				)}
			>
				{letter}
			</div>
			{running && (
				<span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-accent">
					<span className="absolute inset-0 rounded-full bg-accent animate-ping" />
				</span>
			)}
		</div>
	)
}

// ─── Metrics row ─────────────────────────────────────────────────────

function MetricsRow({
	usage,
	startedAt,
	endedAt,
	running,
}: {
	usage: TaskUsage | undefined
	startedAt: number | undefined
	endedAt: number | undefined
	running: boolean
}) {
	const elapsed = useElapsed(startedAt, endedAt, running)
	return (
		<div className="mt-3 grid grid-cols-3 gap-2">
			<MetricTile
				label="tokens"
				value={usage?.total_tokens !== undefined ? formatNumber(usage.total_tokens) : "—"}
			/>
			<MetricTile
				label="calls"
				value={usage?.tool_uses !== undefined ? String(usage.tool_uses) : "—"}
			/>
			<MetricTile
				label={running ? "elapsed" : "duration"}
				value={elapsed ? formatDuration(elapsed) : "—"}
				live={running}
			/>
		</div>
	)
}

function MetricTile({ label, value, live }: { label: string; value: string; live?: boolean }) {
	return (
		<div
			className={cn(
				"flex flex-col gap-0.5 rounded-lg border border-border/40 bg-surface/60 px-2.5 py-2",
				live && "border-accent/40",
			)}
		>
			<span className="text-[9px] uppercase tracking-wide text-muted-foreground/70">{label}</span>
			<span className="text-sm font-semibold tabular-nums text-foreground">{value}</span>
		</div>
	)
}

// ─── Task row ────────────────────────────────────────────────────────

function TaskRow({
	task,
	focused,
	onClick,
}: {
	task: ToolPart
	focused: boolean
	onClick: () => void
}) {
	const description = (task.input?.description as string | undefined) ?? "Background subagent"
	const taskType = (task.input?.task_type as string | undefined) ?? undefined
	const usage = readUsage(task)
	const startedAt = task.time?.start
	const endedAt = task.time?.end
	const running = task.state === "running" || task.state === "pending"
	const elapsed = useElapsed(startedAt, endedAt, running)

	return (
		<li>
			<button
				type="button"
				data-task-id={task.callId}
				onClick={onClick}
				className={cn(
					"group flex w-full items-center gap-3 rounded-xl border border-border/40 bg-background/30 px-3 py-2.5 text-left transition-all",
					"hover:border-border/70 hover:bg-background/60",
					focused && "border-accent/50 bg-accent/5 shadow-[0_0_0_1px_var(--accent-muted)]",
				)}
			>
				<StateDot state={task.state} />
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="min-w-0 truncate text-[13px] font-medium text-foreground">
							{description}
						</span>
						{taskType && (
							<span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
								{taskType}
							</span>
						)}
					</div>
					<div className="mt-0.5 flex items-center gap-2 text-[10px] tabular-nums text-muted-foreground">
						{elapsed !== undefined && <span>{formatDuration(elapsed)}</span>}
						{usage?.total_tokens !== undefined && (
							<>
								{elapsed !== undefined && <Dot />}
								<span>{formatNumber(usage.total_tokens)} tok</span>
							</>
						)}
						{usage?.tool_uses !== undefined && (
							<>
								<Dot />
								<span>
									{usage.tool_uses} {usage.tool_uses === 1 ? "call" : "calls"}
								</span>
							</>
						)}
					</div>
				</div>
				<ChevronIcon />
			</button>
		</li>
	)
}

function StateDot({ state }: { state: string }) {
	if (state === "running" || state === "pending") {
		return (
			<span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
				<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
				<span className="relative h-2 w-2 rounded-full bg-accent" />
			</span>
		)
	}
	if (state === "completed") {
		return <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
	}
	if (state === "error") {
		return <span className="h-2 w-2 shrink-0 rounded-full bg-error" aria-hidden="true" />
	}
	return <span className="h-2 w-2 shrink-0 rounded-full bg-muted" aria-hidden="true" />
}

function StateBadge({ state }: { state: string }) {
	// Matches Claude Code desktop + t3code: a background subagent is
	// "Launched" — the parent task is done dispatching. Progress events
	// update metrics but don't change the label until the terminal
	// notification arrives.
	const label =
		state === "running" || state === "pending"
			? "LAUNCHED"
			: state === "completed"
				? "DONE"
				: state === "error"
					? "FAILED"
					: state.toUpperCase()
	const tone =
		state === "completed"
			? "bg-success/15 text-success"
			: state === "error"
				? "bg-error/15 text-error"
				: "bg-accent/15 text-accent"
	return (
		<span
			className={cn(
				"shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
				tone,
			)}
		>
			{label}
		</span>
	)
}

function SpinnerDot() {
	return (
		<span className="relative flex h-2 w-2 items-center justify-center">
			<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
			<span className="relative h-2 w-2 rounded-full bg-accent" />
		</span>
	)
}

function ChevronIcon() {
	return (
		<svg
			width="12"
			height="12"
			viewBox="0 0 12 12"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className="shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5"
			aria-hidden="true"
		>
			<title>Open</title>
			<path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
		</svg>
	)
}

function CloseIcon() {
	return (
		<svg
			width="13"
			height="13"
			viewBox="0 0 13 13"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<title>Close</title>
			<path
				d="M3 3L10 10M3 10L10 3"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>
		</svg>
	)
}

// ─── Empty state ─────────────────────────────────────────────────────

function EmptyState() {
	return (
		<div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
			<div className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-border/60 bg-surface/40 text-muted-foreground/70">
				<EmptyIcon />
			</div>
			<div className="flex flex-col gap-1">
				<div className="text-[13px] font-medium text-foreground">No subagents yet</div>
				<div className="text-[11px] leading-relaxed text-muted-foreground">
					When the agent dispatches background work via the Task tool, live progress shows up here.
				</div>
			</div>
		</div>
	)
}

function EmptyIcon() {
	return (
		<svg
			width="18"
			height="18"
			viewBox="0 0 18 18"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<title>Empty</title>
			<circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" />
			<circle cx="9" cy="9" r="1.5" fill="currentColor" />
		</svg>
	)
}

// ─── Utilities ───────────────────────────────────────────────────────

interface TaskUsage {
	total_tokens?: number
	tool_uses?: number
	duration_ms?: number
}

function readUsage(task: ToolPart): TaskUsage | undefined {
	const raw = task.metadata?.usage
	if (!raw || typeof raw !== "object") return undefined
	return raw as TaskUsage
}

/** Live elapsed time in ms — for running tasks, ticks every second. */
function useElapsed(
	startedAt: number | undefined,
	endedAt: number | undefined,
	running: boolean,
): number | undefined {
	const [now, setNow] = useState(() => Date.now())
	useEffect(() => {
		if (!running) return
		const id = setInterval(() => setNow(Date.now()), 1000)
		return () => clearInterval(id)
	}, [running])
	if (startedAt === undefined) return undefined
	const end = endedAt ?? (running ? now : startedAt)
	return Math.max(0, end - startedAt)
}

function formatNumber(n: number): string {
	if (n < 1000) return String(n)
	if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
	return `${(n / 1_000_000).toFixed(1)}M`
}

function formatDuration(ms: number): string {
	const s = Math.floor(ms / 1000)
	if (s < 60) return `${s}s`
	const m = Math.floor(s / 60)
	const r = s % 60
	if (m < 60) return `${m}m ${r}s`
	const h = Math.floor(m / 60)
	return `${h}h ${m % 60}m`
}
