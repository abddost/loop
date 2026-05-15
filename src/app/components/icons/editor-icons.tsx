import type { ComponentProps } from "react"

// ─── Image assets (Vite resolves these to URLs) ─────────────
import androidStudioSvg from "../../assets/icons/editors/android-studio.svg"
import cursorPng from "../../assets/icons/editors/cursor.png"
import finderPng from "../../assets/icons/editors/finder.png"
import ghosttyPng from "../../assets/icons/editors/ghostty.png"
import sublimeSvg from "../../assets/icons/editors/sublimetext.svg"
import terminalPng from "../../assets/icons/editors/terminal.png"
import vscodeSvg from "../../assets/icons/editors/vscode.svg"
// Windsurf is loaded as raw SVG so its `currentColor` fill follows the text
// color — otherwise the brand mark renders near-black on dark backgrounds.
import windsurfSvgSource from "../../assets/icons/editors/windsurf.svg?raw"
import xcodePng from "../../assets/icons/editors/xcode.png"
import zedPng from "../../assets/icons/editors/zed.png"

const ICON_ASSETS: Record<string, string> = {
	vscode: vscodeSvg,
	cursor: cursorPng,
	zed: zedPng,
	sublime: sublimeSvg,
	xcode: xcodePng,
	"android-studio": androidStudioSvg,
	terminal: terminalPng,
	ghostty: ghosttyPng,
	finder: finderPng,
}

type EditorIconProps = {
	id: string
	/** Wrap the icon in a soft background tile (useful in menus). */
	tile?: boolean
} & Omit<ComponentProps<"img">, "src" | "alt">

/**
 * Editor icon by ID.
 * With `tile`, wraps the image in a light rounded square — gives consistent
 * visual framing and clips PNG edge artifacts (terminal, ghostty).
 * The Windsurf logo is rendered inline so its `currentColor` fill adapts to
 * light/dark themes.
 */
export function EditorIcon({
	id,
	width = 16,
	height = 16,
	tile = false,
	className,
	style,
	...props
}: EditorIconProps) {
	if (id === "windsurf") {
		return (
			<span
				aria-hidden="true"
				className={
					className
						? `${className} inline-flex shrink-0 items-center justify-center text-foreground [&>svg]:h-full [&>svg]:w-full`
						: "inline-flex shrink-0 items-center justify-center text-foreground [&>svg]:h-full [&>svg]:w-full"
				}
				style={{ width, height, ...style }}
				// biome-ignore lint/security/noDangerouslySetInnerHtml: bundled trusted asset
				dangerouslySetInnerHTML={{ __html: windsurfSvgSource }}
			/>
		)
	}

	const asset = ICON_ASSETS[id]
	if (!asset) return null

	const img = (
		// biome-ignore lint/a11y/useAltText: decorative icon next to text label
		<img
			src={asset}
			alt=""
			aria-hidden="true"
			width={tile ? undefined : width}
			height={tile ? undefined : height}
			draggable={false}
			style={{ objectFit: "contain", ...(tile ? { width: "100%", height: "100%" } : {}) }}
			className={tile ? undefined : className}
			{...props}
		/>
	)

	if (!tile) return img

	return (
		<span
			aria-hidden="true"
			className={className}
			style={{
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				width,
				height,
				borderRadius: 6,
				overflow: "hidden",
				flexShrink: 0,
			}}
		>
			{img}
		</span>
	)
}
