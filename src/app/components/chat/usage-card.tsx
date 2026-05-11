import type { UsagePart } from "@core/schema/part"
import { useMemo, useState } from "react"
import { apiClient } from "../../lib/api-client"
import { cn } from "../ui/cn"

interface UsageCardProps {
	initial: UsagePart
}

type Tab = "overview" | "models"
type Range = UsagePart["range"]

/**
 * Render a `/usage` snapshot exactly as displayed in the chat: tabs
 * (Overview / Models), range filter (All / 30d / 7d), 8-stat grid,
 * activity heatmap, and the comparison line. Re-fetches when the user
 * switches range; the persisted snapshot stays untouched in the DB.
 *
 * The range refresh uses `apiClient`'s default workspace directory (set
 * at bootstrap) so the card doesn't need any context plumbing — it's a
 * dumb renderer of a persisted part.
 */
export function UsageCard({ initial }: UsageCardProps) {
	const [tab, setTab] = useState<Tab>("overview")
	const [range, setRange] = useState<Range>(initial.range)
	const [data, setData] = useState<UsagePart>(initial)
	const [loading, setLoading] = useState(false)

	const handleRangeChange = async (next: Range) => {
		if (next === range) return
		setRange(next)
		setLoading(true)
		try {
			const fresh = await apiClient.get<UsagePart>(`/usage?range=${next}`)
			setData(fresh)
		} catch (err) {
			console.error("[usage]", err)
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className="my-2 w-full max-w-3xl rounded-2xl border border-border bg-surface p-4 shadow-[var(--shadow-inset)]">
			<div className="mb-4 flex items-center justify-between">
				<div className="flex items-center gap-1 text-xs">
					<TabButton active={tab === "overview"} onClick={() => setTab("overview")}>
						Overview
					</TabButton>
					<TabButton active={tab === "models"} onClick={() => setTab("models")}>
						Models
					</TabButton>
				</div>
				<div className="flex items-center gap-1 text-[11px]">
					<RangeButton
						active={range === "all"}
						onClick={() => handleRangeChange("all")}
					>
						All
					</RangeButton>
					<RangeButton
						active={range === "30d"}
						onClick={() => handleRangeChange("30d")}
					>
						30d
					</RangeButton>
					<RangeButton
						active={range === "7d"}
						onClick={() => handleRangeChange("7d")}
					>
						7d
					</RangeButton>
				</div>
			</div>

			{tab === "overview" ? (
				<OverviewView data={data} loading={loading} />
			) : (
				<ModelsView data={data} loading={loading} />
			)}
		</div>
	)
}

function TabButton({
	active,
	onClick,
	children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"rounded-md px-2.5 py-1 font-medium transition-colors",
				active
					? "bg-foreground/10 text-foreground"
					: "text-muted hover:text-foreground",
			)}
		>
			{children}
		</button>
	)
}

function RangeButton({
	active,
	onClick,
	children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"rounded-md px-2 py-0.5 tabular-nums transition-colors",
				active
					? "bg-foreground/12 text-foreground"
					: "text-muted hover:text-foreground",
			)}
		>
			{children}
		</button>
	)
}

// ─── Overview view ────────────────────────────────────────────────────

function OverviewView({ data, loading }: { data: UsagePart; loading: boolean }) {
	const { stats, heatmap, comparison } = data
	const peakHourLabel = stats.peakHour < 0 ? "—" : formatHour(stats.peakHour)
	const favorite = stats.favoriteModel ? formatModelName(stats.favoriteModel) : "—"
	return (
		<div className={cn(loading && "opacity-50 transition-opacity")}>
			<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
				<StatCell label="Sessions" value={formatCount(stats.sessions)} />
				<StatCell label="Messages" value={formatCount(stats.messages)} />
				<StatCell label="Total tokens" value={formatTokens(stats.totalTokens)} />
				<StatCell label="Active days" value={formatCount(stats.activeDays)} />
				<StatCell label="Current streak" value={`${stats.currentStreak}d`} />
				<StatCell label="Longest streak" value={`${stats.longestStreak}d`} />
				<StatCell label="Peak hour" value={peakHourLabel} />
				<StatCell label="Favorite model" value={favorite} />
			</div>
			<Heatmap heatmap={heatmap} />
			{comparison && (
				<p className="mt-3 px-1 text-[11.5px] text-muted">{comparison}</p>
			)}
		</div>
	)
}

function StatCell({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-xl border border-border/60 bg-foreground/[0.05] p-3">
			<div className="text-[11px] text-muted">{label}</div>
			<div className="mt-0.5 font-semibold text-base text-foreground tabular-nums">
				{value}
			</div>
		</div>
	)
}

// ─── Models view ──────────────────────────────────────────────────────

function ModelsView({ data, loading }: { data: UsagePart; loading: boolean }) {
	if (data.models.length === 0) {
		return (
			<div
				className={cn(
					"rounded-xl border border-border/60 bg-foreground/[0.05] p-6 text-center text-xs text-muted",
					loading && "opacity-50 transition-opacity",
				)}
			>
				No model usage recorded for this range yet.
			</div>
		)
	}
	const total = data.stats.totalTokens || 1
	return (
		<div className={cn("space-y-2", loading && "opacity-50 transition-opacity")}>
			{data.models.map((m) => {
				const pct = Math.round((m.tokens / total) * 100)
				return (
					<div
						key={m.modelId}
						className="rounded-xl border border-border/60 bg-foreground/[0.05] p-3"
					>
						<div className="flex items-center justify-between text-xs">
							<span className="font-medium text-foreground">
								{formatModelName(m.modelId)}
							</span>
							<span className="text-muted tabular-nums">
								{formatTokens(m.tokens)} ({pct}%)
							</span>
						</div>
						<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/10">
							<div
								className="h-full rounded-full bg-foreground/30"
								style={{ width: `${pct}%` }}
							/>
						</div>
						<div className="mt-2 grid grid-cols-4 gap-2 text-[10.5px] text-muted tabular-nums">
							<span>Cached: {formatTokens(m.cached)}</span>
							<span>Input: {formatTokens(m.input)}</span>
							<span>Output: {formatTokens(m.output)}</span>
							<span>Cost: ${m.cost.toFixed(2)}</span>
						</div>
					</div>
				)
			})}
		</div>
	)
}

// ─── Heatmap ──────────────────────────────────────────────────────────

interface HeatmapCell {
	date: string
	messages: number
}

/**
 * Render a calendar-style heatmap. Days are laid out top-to-bottom in
 * columns of 7 (one column per week). The earliest column starts on
 * the heatmap's first Sunday so the grid aligns visually.
 */
function Heatmap({ heatmap }: { heatmap: HeatmapCell[] }) {
	const grid = useMemo(() => buildGrid(heatmap), [heatmap])
	const max = useMemo(
		() => heatmap.reduce((best, c) => Math.max(best, c.messages), 0),
		[heatmap],
	)

	return (
		<div className="mt-4 overflow-x-auto">
			<div className="flex gap-[3px]">
				{grid.map((week, wIdx) => (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: stable column index
						key={wIdx}
						className="flex flex-col gap-[3px]"
					>
						{week.map((cell, dIdx) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: stable cell index
								key={dIdx}
								className={cn(
									"h-3 w-3 rounded-[3px]",
									cell ? cellClass(cell.messages, max) : "opacity-0",
								)}
								title={
									cell
										? `${cell.date}: ${cell.messages} message${cell.messages === 1 ? "" : "s"}`
										: undefined
								}
							/>
						))}
					</div>
				))}
			</div>
		</div>
	)
}

function buildGrid(heatmap: HeatmapCell[]): Array<Array<HeatmapCell | null>> {
	if (heatmap.length === 0) return []
	const first = parseIsoDay(heatmap[0].date)
	const dow = first.getDay() // 0 = Sun … 6 = Sat
	const padded: Array<HeatmapCell | null> = []
	for (let i = 0; i < dow; i++) padded.push(null)
	for (const cell of heatmap) padded.push(cell)
	const weeks: Array<Array<HeatmapCell | null>> = []
	for (let i = 0; i < padded.length; i += 7) {
		const week = padded.slice(i, i + 7)
		while (week.length < 7) week.push(null)
		weeks.push(week)
	}
	return weeks
}

function parseIsoDay(iso: string): Date {
	const [y, m, d] = iso.split("-").map((s) => Number.parseInt(s, 10))
	return new Date(y, m - 1, d)
}

function cellClass(count: number, max: number): string {
	if (count === 0) return "bg-foreground/[0.10] ring-1 ring-inset ring-border/40"
	const ratio = max > 0 ? count / max : 0
	// Five-step scale, from faint to saturated indigo.
	if (ratio < 0.2) return "bg-indigo-500/30"
	if (ratio < 0.4) return "bg-indigo-500/45"
	if (ratio < 0.6) return "bg-indigo-500/60"
	if (ratio < 0.8) return "bg-indigo-500/75"
	return "bg-indigo-500/90"
}

// ─── Formatting helpers ──────────────────────────────────────────────

function formatCount(n: number): string {
	return n.toLocaleString()
}

function formatTokens(n: number): string {
	if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
	if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
	return n.toString()
}

function formatHour(h: number): string {
	const period = h >= 12 ? "PM" : "AM"
	const display = h === 0 ? 12 : h > 12 ? h - 12 : h
	return `${display} ${period}`
}

function formatModelName(modelId: string): string {
	// Strip provider prefixes like "anthropic/" and version suffixes; the
	// SDK emits ids like "claude-sonnet-4-5" / "claude-opus-4-7".
	const slug = modelId.split("/").pop() ?? modelId
	const replaced = slug.replace(/^claude-/, "Claude ").replace(/-/g, " ")
	return replaced.replace(/\b([a-z])/g, (_, c) => c.toUpperCase())
}
