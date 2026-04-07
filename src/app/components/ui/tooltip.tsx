import type { ActionId } from "@core/schema/keybinding"
import { TooltipContent, TooltipRoot, TooltipTrigger } from "@heroui/react"
import type { ReactNode } from "react"
import { useKeybindParts } from "../../hooks/use-keybinding"
import { cn } from "./cn"

// ── Kbd Badge ──────────────────────────────────────────────────

function KbdBadge({ children }: { children: string }) {
	return (
		<kbd
			className={cn(
				"inline-flex h-[18px] min-w-[18px] items-center justify-center",
				"rounded border border-border/40 bg-surface-hover/60",
				"px-1 font-mono text-[10px] font-medium leading-none text-muted-foreground",
			)}
		>
			{children}
		</kbd>
	)
}

// ── Shortcut Display ───────────────────────────────────────────

function ShortcutBadges({ actionId }: { actionId: ActionId }) {
	const parts = useKeybindParts(actionId)
	if (parts.length === 0) return null

	return (
		<span className="ml-2.5 inline-flex items-center gap-0.5">
			{parts.map((part) => (
				<KbdBadge key={part}>{part}</KbdBadge>
			))}
		</span>
	)
}

// ── Tooltip ────────────────────────────────────────────────────

export interface TooltipProps {
	/** Tooltip text content. */
	content: ReactNode
	/** Action ID to display keybinding badges for. */
	shortcut?: ActionId
	/** Tooltip placement. */
	side?: "top" | "bottom" | "left" | "right"
	/** Show delay in ms. */
	delay?: number
	/** Trigger element. */
	children: ReactNode
	/** Additional class name for the trigger wrapper. */
	className?: string
}

export function Tooltip({
	content,
	shortcut,
	side = "bottom",
	delay = 400,
	children,
	className,
}: TooltipProps) {
	return (
		<TooltipRoot delay={delay} closeDelay={0}>
			<TooltipTrigger className={className}>{children}</TooltipTrigger>
			<TooltipContent
				placement={side}
				offset={6}
				className={cn(
					"flex items-center gap-1",
					"rounded-lg border border-border/50 bg-overlay px-2.5 py-1.5",
					"text-xs font-medium text-foreground shadow-xl shadow-black/30",
					"animate-in fade-in-0 zoom-in-95 data-[placement=bottom]:slide-in-from-top-1",
					"data-[placement=top]:slide-in-from-bottom-1",
					"data-[placement=left]:slide-in-from-right-1",
					"data-[placement=right]:slide-in-from-left-1",
				)}
			>
				<span>{content}</span>
				{shortcut && <ShortcutBadges actionId={shortcut} />}
			</TooltipContent>
		</TooltipRoot>
	)
}
