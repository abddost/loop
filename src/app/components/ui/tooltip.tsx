import type { ActionId } from "@core/schema/keybinding"
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useKeybindParts } from "../../hooks/use-keybinding"
import { cn } from "./cn"

// ── Kbd Badge ──────────────────────────────────────────────────

function KbdBadge({ children }: { children: string }) {
	return (
		<kbd
			className={cn(
				"inline-flex h-[18px] min-w-[18px] items-center justify-center",
				"rounded-md bg-surface-hover/60",
				"px-1 font-mono text-[10px] font-medium leading-none text-muted-foreground",
				"shadow-[var(--shadow-inset)]",
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
	/** When true, suppress the tooltip and force-close it if open. */
	disabled?: boolean
}

const OFFSET = 6
const VIEWPORT_PADDING = 8

/**
 * Tooltip with per-trigger delay. Unlike react-aria's TooltipTrigger, there is
 * no global "warmup" state — every hover waits the full delay before showing,
 * even when moving between adjacent triggers.
 */
export function Tooltip({
	content,
	shortcut,
	side = "bottom",
	delay = 400,
	children,
	className,
	disabled,
}: TooltipProps) {
	const [isOpen, setIsOpen] = useState(false)
	const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
	const triggerRef = useRef<HTMLDivElement | null>(null)
	const tooltipRef = useRef<HTMLDivElement | null>(null)
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const id = useId()

	const handleEnter = () => {
		if (disabled) return
		if (timerRef.current) clearTimeout(timerRef.current)
		timerRef.current = setTimeout(() => {
			timerRef.current = null
			setIsOpen(true)
		}, delay)
	}

	const handleLeave = () => {
		if (timerRef.current) clearTimeout(timerRef.current)
		timerRef.current = null
		setIsOpen(false)
	}

	useEffect(
		() => () => {
			if (timerRef.current) clearTimeout(timerRef.current)
		},
		[],
	)

	useEffect(() => {
		if (!disabled) return
		if (timerRef.current) {
			clearTimeout(timerRef.current)
			timerRef.current = null
		}
		setIsOpen(false)
	}, [disabled])

	useLayoutEffect(() => {
		if (!isOpen || !triggerRef.current || !tooltipRef.current) return
		const trig = triggerRef.current.getBoundingClientRect()
		const tip = tooltipRef.current.getBoundingClientRect()
		let top = 0
		let left = 0
		switch (side) {
			case "top":
				top = trig.top - tip.height - OFFSET
				left = trig.left + (trig.width - tip.width) / 2
				break
			case "bottom":
				top = trig.bottom + OFFSET
				left = trig.left + (trig.width - tip.width) / 2
				break
			case "left":
				top = trig.top + (trig.height - tip.height) / 2
				left = trig.left - tip.width - OFFSET
				break
			case "right":
				top = trig.top + (trig.height - tip.height) / 2
				left = trig.right + OFFSET
				break
		}
		left = Math.max(
			VIEWPORT_PADDING,
			Math.min(left, window.innerWidth - tip.width - VIEWPORT_PADDING),
		)
		top = Math.max(
			VIEWPORT_PADDING,
			Math.min(top, window.innerHeight - tip.height - VIEWPORT_PADDING),
		)
		setPosition({ top, left })
	}, [isOpen, side])

	return (
		<>
			<div
				ref={triggerRef}
				className={className}
				onPointerEnter={handleEnter}
				onPointerLeave={handleLeave}
				onFocus={handleEnter}
				onBlur={handleLeave}
				aria-describedby={isOpen ? id : undefined}
			>
				{children}
			</div>
			{isOpen &&
				createPortal(
					<div
						ref={tooltipRef}
						id={id}
						role="tooltip"
						data-placement={side}
						style={{
							position: "fixed",
							top: position.top,
							left: position.left,
							zIndex: 9999,
							pointerEvents: "none",
						}}
						className={cn(
							"flex items-center gap-1",
							"rounded-lg bg-overlay px-2.5 py-1.5",
							"text-xs font-medium text-foreground",
							"shadow-[var(--shadow-dropdown)]",
							"animate-in fade-in-0 zoom-in-95 data-[placement=bottom]:slide-in-from-top-1",
							"data-[placement=top]:slide-in-from-bottom-1",
							"data-[placement=left]:slide-in-from-right-1",
							"data-[placement=right]:slide-in-from-left-1",
						)}
					>
						<span>{content}</span>
						{shortcut && <ShortcutBadges actionId={shortcut} />}
					</div>,
					document.body,
				)}
		</>
	)
}
