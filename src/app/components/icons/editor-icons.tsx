import type { ComponentProps } from "react"

// ─── Image assets (Vite resolves these to URLs) ─────────────
import androidStudioSvg from "../../assets/icons/editors/android-studio.svg"
import cursorSvg from "../../assets/icons/editors/cursor.svg"
import finderPng from "../../assets/icons/editors/finder.png"
import sublimeSvg from "../../assets/icons/editors/sublimetext.svg"
import vscodeSvg from "../../assets/icons/editors/vscode.svg"
import xcodePng from "../../assets/icons/editors/xcode.png"
import zedSvg from "../../assets/icons/editors/zed.svg"

// ─── Asset-based icon map ───────────────────────────────────

const ICON_ASSETS: Record<string, string> = {
	vscode: vscodeSvg,
	cursor: cursorSvg,
	zed: zedSvg,
	sublime: sublimeSvg,
	xcode: xcodePng,
	"android-studio": androidStudioSvg,
	finder: finderPng,
}

// ─── Inline SVG fallbacks (editors without assets) ──────────

type SvgProps = Omit<ComponentProps<"svg">, "children">

function FallbackIcon({
	viewBox = "0 0 24 24",
	children,
	...props
}: SvgProps & { children: React.ReactNode }) {
	return (
		<svg width={16} height={16} viewBox={viewBox} fill="none" aria-hidden="true" {...props}>
			{children}
		</svg>
	)
}

function WindsurfIcon(props: SvgProps) {
	return (
		<FallbackIcon {...props}>
			<path
				d="M3 16.5c2.5-3 5-6 7.5-3s5-.5 7.5-3.5M3 12c2.5-3 5-6 7.5-3s5-.5 7.5-3.5"
				stroke="#00B4D8"
				strokeWidth="2.5"
				strokeLinecap="round"
				fill="none"
			/>
		</FallbackIcon>
	)
}

function IntelliJIcon(props: SvgProps) {
	return (
		<FallbackIcon {...props}>
			<rect x="3" y="3" width="18" height="18" rx="1.5" fill="#000" />
			<path d="M5.5 5.5h6v1.5h-6zM5.5 17h5v1.5h-5z" fill="#fff" />
			<path
				d="M2 8l4.5-6h5.5L6 8zM22 8l-4.5-6H12l6 6zM22 16l-4.5 6H12l6-6zM2 16l4.5 6h5.5L6 16z"
				fill="url(#idea-grad)"
			/>
			<defs>
				<linearGradient id="idea-grad" x1="2" y1="2" x2="22" y2="22">
					<stop stopColor="#F97A12" />
					<stop offset="0.4" stopColor="#B07AF4" />
					<stop offset="1" stopColor="#3BEA62" />
				</linearGradient>
			</defs>
		</FallbackIcon>
	)
}

function WebStormIcon(props: SvgProps) {
	return (
		<FallbackIcon {...props}>
			<rect x="3" y="3" width="18" height="18" rx="1.5" fill="#000" />
			<path d="M5.5 5.5h6v1.5h-6zM5.5 17h5v1.5h-5z" fill="#fff" />
			<path
				d="M2 8l4.5-6h5.5L6 8zM22 8l-4.5-6H12l6 6zM22 16l-4.5 6H12l6-6zM2 16l4.5 6h5.5L6 16z"
				fill="url(#ws-grad)"
			/>
			<defs>
				<linearGradient id="ws-grad" x1="2" y1="2" x2="22" y2="22">
					<stop stopColor="#07C3F2" />
					<stop offset="0.4" stopColor="#087CFA" />
					<stop offset="1" stopColor="#21D789" />
				</linearGradient>
			</defs>
		</FallbackIcon>
	)
}

function NeovimIcon(props: SvgProps) {
	return (
		<FallbackIcon {...props}>
			<path d="M4 20V4l5 2v10l6-12h1.5v16l-5-2V8L5.5 20H4z" fill="#57A143" />
			<path d="M4 4l5 2v10L4 20V4z" fill="#4B8B3B" />
			<path d="M15.5 4L9 16V6l5.5-2H16z" fill="#69B74C" />
		</FallbackIcon>
	)
}

const INLINE_ICONS: Record<string, (props: SvgProps) => React.ReactElement> = {
	windsurf: WindsurfIcon,
	idea: IntelliJIcon,
	webstorm: WebStormIcon,
	neovim: NeovimIcon,
}

// ─── Public component ───────────────────────────────────────

type EditorIconProps = { id: string } & Omit<ComponentProps<"img">, "src" | "alt">

/** Editor icon by ID. Uses image assets where available, inline SVG fallback otherwise. */
export function EditorIcon({ id, width = 16, height = 16, ...props }: EditorIconProps) {
	const asset = ICON_ASSETS[id]
	if (asset) {
		return (
			// biome-ignore lint/a11y/useAltText: decorative icon next to text label
			<img
				src={asset}
				alt=""
				aria-hidden="true"
				width={width}
				height={height}
				draggable={false}
				style={{ objectFit: "contain" }}
				{...props}
			/>
		)
	}

	const InlineIcon = INLINE_ICONS[id]
	if (InlineIcon) {
		return <InlineIcon width={width as number} height={height as number} />
	}

	return null
}
