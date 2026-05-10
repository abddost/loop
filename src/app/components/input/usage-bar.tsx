import { useState } from "react"
import type { SessionUsage } from "../../stores/workspace-store"

function formatTokenCount(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
	if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
	return String(n)
}

function formatCost(cost: number): string {
	if (cost < 0.01) return `$${cost.toFixed(4)}`
	return `$${cost.toFixed(2)}`
}

const RING_SIZE = 16
const STROKE_WIDTH = 2
const RADIUS = (RING_SIZE - STROKE_WIDTH) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function UsageBar({ usage }: { usage: SessionUsage | undefined }) {
	const [showTooltip, setShowTooltip] = useState(false)
	if (!usage) return null

	// "Tokens used" must equal the full prompt + last response: Anthropic
	// splits input across `input` (non-cached), `cacheRead`, and `cacheWrite`
	// — leaving cache out under-counts; only summing input+output ignores
	// the bulk of an agentic conversation that lives in the cache.
	const totalUsed =
		usage.input +
		usage.output +
		(usage.reasoning ?? 0) +
		(usage.cacheRead ?? 0) +
		(usage.cacheWrite ?? 0)
	const pctUsed = Math.min((totalUsed / usage.contextWindow) * 100, 100)
	const pctLeft = Math.round(100 - pctUsed)
	const dashOffset = CIRCUMFERENCE - (pctUsed / 100) * CIRCUMFERENCE

	return (
		<div
			className="relative flex h-7 w-7 items-center justify-center"
			onMouseEnter={() => setShowTooltip(true)}
			onMouseLeave={() => setShowTooltip(false)}
		>
			<svg
				width={RING_SIZE}
				height={RING_SIZE}
				className="cursor-pointer"
				role="img"
				aria-label={`Context window: ${Math.round(pctUsed)}% used`}
			>
				<title>Context window usage</title>
				<circle
					cx={RING_SIZE / 2}
					cy={RING_SIZE / 2}
					r={RADIUS}
					fill="none"
					stroke="currentColor"
					strokeWidth={STROKE_WIDTH}
					className="text-foreground/15"
				/>
				<circle
					cx={RING_SIZE / 2}
					cy={RING_SIZE / 2}
					r={RADIUS}
					fill="none"
					stroke="currentColor"
					strokeWidth={STROKE_WIDTH}
					strokeDasharray={CIRCUMFERENCE}
					strokeDashoffset={dashOffset}
					strokeLinecap="round"
					className="text-foreground/45 transition-[stroke-dashoffset] duration-300"
					transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
				/>
			</svg>

			{showTooltip && (
				<div className="absolute bottom-full right-0 z-50 mb-2 whitespace-nowrap el-dropdown px-3 py-2 text-xs text-muted-foreground">
					<div className="font-medium text-foreground">Context window:</div>
					<div>
						{Math.round(pctUsed)}% used ({pctLeft}% left)
					</div>
					<div>
						{formatTokenCount(totalUsed)} / {formatTokenCount(usage.contextWindow)} tokens used
					</div>
					{usage.cost > 0 && <div className="mt-1">Cost: {formatCost(usage.cost)}</div>}
				</div>
			)}
		</div>
	)
}
