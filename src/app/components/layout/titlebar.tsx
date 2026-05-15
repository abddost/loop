import { TRAFFIC_LIGHT_GUTTER_PX } from "../../lib/platform"
import { cn } from "../ui/cn"

export interface TitlebarProps {
	className?: string
}

/**
 * Custom titlebar with drag region. Reserves left padding for the macOS
 * traffic lights so the window controls don't overlap the content. On
 * Linux/Windows the padding collapses to 0 — those platforms paint their
 * window chrome elsewhere. 40px height matching the content titlebar for
 * vertical alignment.
 */
export function Titlebar({ className }: TitlebarProps) {
	return (
		<div
			style={
				{
					WebkitAppRegion: "drag",
					paddingLeft: TRAFFIC_LIGHT_GUTTER_PX,
				} as React.CSSProperties
			}
			className={cn("flex h-10 shrink-0 items-center pr-3", "select-none", className)}
		/>
	)
}
