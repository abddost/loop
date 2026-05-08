import { cn } from "../ui/cn"
import { Tooltip } from "../ui/tooltip"

// ─── Provider Colors ────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, { bg: string; text: string }> = {
	anthropic: { bg: "bg-orange-500/15", text: "text-orange-400" },
	openai: { bg: "bg-emerald-500/15", text: "text-emerald-400" },
	google: { bg: "bg-blue-500/15", text: "text-blue-400" },
	openrouter: { bg: "bg-violet-500/15", text: "text-violet-400" },
	xai: { bg: "bg-slate-400/15", text: "text-slate-300" },
	mistral: { bg: "bg-amber-500/15", text: "text-amber-400" },
	groq: { bg: "bg-pink-500/15", text: "text-pink-400" },
	deepseek: { bg: "bg-cyan-500/15", text: "text-cyan-400" },
	"github-copilot": { bg: "bg-sky-500/15", text: "text-sky-400" },
	cohere: { bg: "bg-rose-500/15", text: "text-rose-400" },
	deepinfra: { bg: "bg-indigo-500/15", text: "text-indigo-400" },
	togetherai: { bg: "bg-teal-500/15", text: "text-teal-400" },
	perplexity: { bg: "bg-lime-500/15", text: "text-lime-400" },
	cerebras: { bg: "bg-fuchsia-500/15", text: "text-fuchsia-400" },
	gitlab: { bg: "bg-red-500/15", text: "text-red-400" },
}

export function getProviderColors(providerId: string): { bg: string; text: string } {
	return PROVIDER_COLORS[providerId] ?? { bg: "bg-surface-hover", text: "text-foreground" }
}

// ─── Provider Avatar ────────────────────────────────────────────

export function ProviderAvatar({
	letter,
	providerId,
	size = "sm",
}: {
	letter: string
	providerId?: string
	size?: "sm" | "md"
}) {
	const colors = providerId
		? getProviderColors(providerId)
		: { bg: "bg-surface-hover", text: "text-foreground" }
	return (
		<div
			className={cn(
				"flex shrink-0 items-center justify-center rounded-lg font-bold",
				colors.bg,
				colors.text,
				size === "sm" ? "h-7 w-7 text-xs" : "h-8 w-8 text-sm",
			)}
		>
			{letter}
		</div>
	)
}

// ─── Source Badge ────────────────────────────────────────────────

type SourceType = "env" | "config" | "custom" | "api"

const SOURCE_CONFIG: Record<SourceType, { label: string; style: string }> = {
	env: { label: "Environment", style: "bg-green-500/10 text-green-400 border-green-500/20" },
	api: { label: "API Key", style: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
	config: { label: "Config", style: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
	custom: { label: "Custom", style: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
}

export function SourceBadge({ source }: { source?: string }) {
	const config =
		source && source in SOURCE_CONFIG
			? SOURCE_CONFIG[source as SourceType]
			: { label: "Connected", style: "bg-surface-hover text-muted-foreground border-border" }
	return (
		<span
			className={cn(
				"rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-tight",
				config.style,
			)}
		>
			{config.label}
		</span>
	)
}

// ─── Early Access Badge ────────────────────────────────────────
//
// Used on provider headers (Cursor, OpenCode, Claude Code) that are
// integrated via subprocess CLIs / ACP rather than Loop's first-party
// AI-SDK path. These integrations work but have known rough edges
// (per-provider event shape variance, sparse usage reporting, missing
// fields on some versions). The badge sets user expectations.

export function EarlyAccessBadge({ className }: { className?: string }) {
	return (
		<Tooltip
			content="Early access integration — things might not work very well yet. Please report issues."
			side="bottom"
			delay={200}
		>
			<span
				className={cn(
					"inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10",
					"px-1.5 py-0.5 text-[10px] font-medium leading-tight text-amber-400",
					"cursor-help select-none",
					className,
				)}
			>
				<svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path d="M12 2L2 22h20L12 2zm0 6l6.5 11.5h-13L12 8zm-1 4v3h2v-3h-2zm0 4v2h2v-2h-2z" />
				</svg>
				<span>Early Access</span>
			</span>
		</Tooltip>
	)
}

// ─── Toggle Switch ──────────────────────────────────────────────

export function ToggleSwitch({
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
				checked ? "bg-accent" : "bg-default shadow-[var(--shadow-inset)]",
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

// ─── Format Helpers ─────────────────────────────────────────────

export function formatError(value: unknown, fallback: string): string {
	if (value && typeof value === "object" && "data" in value) {
		const data = (value as { data?: { message?: unknown } }).data
		if (typeof data?.message === "string" && data.message) return data.message
	}
	if (value && typeof value === "object" && "message" in value) {
		const message = (value as { message?: unknown }).message
		if (typeof message === "string" && message) return message
	}
	if (value instanceof Error && value.message) return value.message
	if (typeof value === "string" && value) return value
	return fallback
}

export function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
	if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`
	return String(n)
}

// ─── Icons ──────────────────────────────────────────────────────

export function ArrowLeftIcon() {
	return (
		<svg
			className="h-4 w-4"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			strokeWidth={2}
			aria-hidden="true"
		>
			<title>Back</title>
			<path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5m7-7l-7 7 7 7" />
		</svg>
	)
}

export function CloseIcon() {
	return (
		<svg
			className="h-4 w-4"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			strokeWidth={2}
			aria-hidden="true"
		>
			<title>Close</title>
			<path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
		</svg>
	)
}

export function CopyIcon() {
	return (
		<svg
			className="h-3.5 w-3.5"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			strokeWidth={1.5}
			aria-hidden="true"
		>
			<title>Copy</title>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"
			/>
		</svg>
	)
}

export function Spinner() {
	return (
		<div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
	)
}

export function ErrorIcon() {
	return (
		<svg
			className="h-4 w-4 shrink-0"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			strokeWidth={2}
			aria-hidden="true"
		>
			<title>Error</title>
			<circle cx="12" cy="12" r="10" />
			<path strokeLinecap="round" d="M15 9l-6 6m0-6l6 6" />
		</svg>
	)
}

export function CheckIcon() {
	return (
		<svg
			className="h-5 w-5 text-success"
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			strokeWidth={2}
			aria-hidden="true"
		>
			<title>Success</title>
			<path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
		</svg>
	)
}
