import type { ReactNode } from "react"
import { useEffect, useRef, useState } from "react"
import {
	type SnackbarItem,
	type SnackbarVariant,
	useSnackbarStore,
} from "../../stores/snackbar-store"
import { cn } from "./cn"

// ── Variant styles ─────────────────────────────────────────────

const VARIANT_STYLES: Record<SnackbarVariant, { bar: string; icon: string; text: string }> = {
	error: {
		bar: "bg-danger/90",
		icon: "text-danger",
		text: "text-danger/90",
	},
	success: {
		bar: "bg-success/90",
		icon: "text-success",
		text: "text-success/90",
	},
	info: {
		bar: "bg-accent/90",
		icon: "text-accent",
		text: "text-accent/90",
	},
}

const VARIANT_ICONS: Record<SnackbarVariant, ReactNode> = {
	error: (
		<svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
			<path d="M8 4.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			<circle cx="8" cy="11" r="0.75" fill="currentColor" />
		</svg>
	),
	success: (
		<svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
			<path
				d="M5.5 8l2 2 3.5-3.5"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	),
	info: (
		<svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
			<circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
			<path d="M8 7v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
			<circle cx="8" cy="5" r="0.75" fill="currentColor" />
		</svg>
	),
}

// ── Single toast ───────────────────────────────────────────────

function SnackbarToast({ item }: { item: SnackbarItem }) {
	const dismiss = useSnackbarStore((s) => s.dismiss)
	const [exiting, setExiting] = useState(false)
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	// Trigger exit animation before removal
	useEffect(() => {
		if (item.duration <= 0) return
		timerRef.current = setTimeout(() => setExiting(true), item.duration - 300)
		return () => {
			if (timerRef.current) clearTimeout(timerRef.current)
		}
	}, [item.duration])

	const styles = VARIANT_STYLES[item.variant]

	return (
		<div
			role="alert"
			className={cn(
				"group pointer-events-auto relative flex w-[340px] items-start gap-2.5 overflow-hidden rounded-lg",
				"border border-border/50 bg-overlay px-3.5 py-3 shadow-lg shadow-black/25",
				"transition-all duration-300 ease-out",
				exiting ? "translate-x-4 opacity-0" : "translate-x-0 opacity-100",
			)}
			style={{ animation: exiting ? undefined : "snackbar-enter 300ms ease-out" }}
		>
			{/* Left accent bar */}
			<div className={cn("absolute left-0 top-0 h-full w-[3px]", styles.bar)} />

			{/* Icon */}
			<span className={cn("mt-0.5 shrink-0", styles.icon)}>{VARIANT_ICONS[item.variant]}</span>

			{/* Message */}
			<p className={cn("flex-1 text-xs leading-relaxed", styles.text)}>{item.message}</p>

			{/* Dismiss */}
			<button
				type="button"
				onClick={() => dismiss(item.id)}
				className="shrink-0 rounded p-0.5 text-muted/50 opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
				aria-label="Dismiss"
			>
				<svg
					className="h-3 w-3"
					viewBox="0 0 12 12"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
					aria-hidden="true"
				>
					<path d="M3 3l6 6M9 3l-6 6" strokeLinecap="round" />
				</svg>
			</button>
		</div>
	)
}

// ── Container ──────────────────────────────────────────────────

export function SnackbarContainer() {
	const items = useSnackbarStore((s) => s.items)

	if (items.length === 0) return null

	return (
		<div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex flex-col-reverse gap-2">
			{items.map((item) => (
				<SnackbarToast key={item.id} item={item} />
			))}
		</div>
	)
}
