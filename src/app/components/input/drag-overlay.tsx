import { cn } from "../ui/cn"

interface DragOverlayProps {
	visible: boolean
}

export function DragOverlay({ visible }: DragOverlayProps) {
	return (
		<div
			className={cn(
				"pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed transition-all duration-150",
				visible ? "border-accent bg-accent/5 opacity-100" : "border-transparent opacity-0",
			)}
		>
			{visible && <span className="text-sm font-medium text-accent">Drop files here</span>}
		</div>
	)
}
