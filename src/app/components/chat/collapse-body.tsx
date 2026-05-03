import { AnimateLayout } from "@openai/apps-sdk-ui/components/Transition"
import type { ReactNode } from "react"

/**
 * Smooth height-animated wrapper for collapsible card bodies.
 *
 * Replaces the `grid-template-rows: 0fr↔1fr` CSS hack that was
 * scattered across the chat surface. Uses WAAPI-driven AnimateLayout
 * on a composite layer, so streaming re-renders inside the body
 * cannot interrupt the open/close animation.
 *
 * Behavior note: when collapsed, children unmount; on re-expand they
 * mount fresh. Acceptable for diff/output bodies where state isn't
 * load-bearing.
 */
export function CollapseBody({
	expanded,
	className,
	children,
}: {
	expanded: boolean
	className?: string
	children: ReactNode
}) {
	return (
		<AnimateLayout
			as="div"
			dimension="height"
			hideOverflow
			forceCompositeLayer
			layoutEnter={{ duration: 200, timingFunction: "cubic-bezier(0.32, 0.72, 0, 1)" }}
			layoutExit={{ duration: 180, timingFunction: "cubic-bezier(0.32, 0.72, 0, 1)" }}
			enter={{ opacity: 1, duration: 160, timingFunction: "cubic-bezier(0.32, 0.72, 0, 1)" }}
			exit={{ opacity: 0, duration: 120, timingFunction: "cubic-bezier(0.32, 0.72, 0, 1)" }}
			initial={{ opacity: 0 }}
		>
			{expanded && (
				<div key="body" className={className}>
					{children}
				</div>
			)}
		</AnimateLayout>
	)
}
