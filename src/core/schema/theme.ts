// ────────────────────────────────────────────────────────────
// Theme data module — single source of truth for all themes
// ────────────────────────────────────────────────────────────

/** Complete set of color tokens a theme must define. */
export interface ThemeColors {
	// Core palette (HeroUI framework vars)
	background: string
	foreground: string
	muted: string
	surface: string
	surfaceForeground: string
	overlay: string
	overlayForeground: string
	accent: string
	accentForeground: string
	success: string
	successForeground: string
	warning: string
	warningForeground: string
	danger: string
	dangerForeground: string
	default: string
	defaultForeground: string
	border: string
	separator: string
	scrollbar: string

	// Field tokens
	fieldBackground: string
	fieldForeground: string
	fieldBorder: string

	// App-specific tokens (--app-*)
	appMutedForeground: string
	appSurfaceHover: string
	appBubbleUser: string
	appInputSurface: string
	appInputBorder: string
	appCodeInline: string
	appCodeBlock: string
	appSendEmptyBorder: string
	appSendEmptyText: string
	appSegmentBg: string
	appPlaceholder: string
	appTerminalBg: string

	// Syntax highlighting (--syntax-*)
	syntaxForeground: string
	syntaxBackground: string
	syntaxComment: string
	syntaxString: string
	syntaxKeyword: string
	syntaxStorage: string
	syntaxFunction: string
	syntaxType: string
	syntaxVariable: string
	syntaxConstant: string
	syntaxNumber: string
	syntaxPunctuation: string
	syntaxRegex: string

	// Terminal ANSI colors (16)
	terminalBlack: string
	terminalRed: string
	terminalGreen: string
	terminalYellow: string
	terminalBlue: string
	terminalMagenta: string
	terminalCyan: string
	terminalWhite: string
	terminalBrightBlack: string
	terminalBrightRed: string
	terminalBrightGreen: string
	terminalBrightYellow: string
	terminalBrightBlue: string
	terminalBrightMagenta: string
	terminalBrightCyan: string
	terminalBrightWhite: string
}

export interface ThemeDefinition {
	id: string
	name: string
	variant: "dark" | "light"
	colors: ThemeColors
}

/** Maps ThemeColors keys to CSS custom property names. */
export const TOKEN_TO_VAR: Record<keyof ThemeColors, string> = {
	background: "--background",
	foreground: "--foreground",
	muted: "--muted",
	surface: "--surface",
	surfaceForeground: "--surface-foreground",
	overlay: "--overlay",
	overlayForeground: "--overlay-foreground",
	accent: "--accent",
	accentForeground: "--accent-foreground",
	success: "--success",
	successForeground: "--success-foreground",
	warning: "--warning",
	warningForeground: "--warning-foreground",
	danger: "--danger",
	dangerForeground: "--danger-foreground",
	default: "--default",
	defaultForeground: "--default-foreground",
	border: "--border",
	separator: "--separator",
	scrollbar: "--scrollbar",
	fieldBackground: "--field-background",
	fieldForeground: "--field-foreground",
	fieldBorder: "--field-border",
	appMutedForeground: "--app-muted-foreground",
	appSurfaceHover: "--app-surface-hover",
	appBubbleUser: "--app-bubble-user",
	appInputSurface: "--app-input-surface",
	appInputBorder: "--app-input-border",
	appCodeInline: "--app-code-inline",
	appCodeBlock: "--app-code-block",
	appSendEmptyBorder: "--app-send-empty-border",
	appSendEmptyText: "--app-send-empty-text",
	appSegmentBg: "--app-segment-bg",
	appPlaceholder: "--app-placeholder",
	appTerminalBg: "--app-terminal-bg",
	syntaxForeground: "--syntax-foreground",
	syntaxBackground: "--syntax-background",
	syntaxComment: "--syntax-comment",
	syntaxString: "--syntax-string",
	syntaxKeyword: "--syntax-keyword",
	syntaxStorage: "--syntax-storage",
	syntaxFunction: "--syntax-function",
	syntaxType: "--syntax-type",
	syntaxVariable: "--syntax-variable",
	syntaxConstant: "--syntax-constant",
	syntaxNumber: "--syntax-number",
	syntaxPunctuation: "--syntax-punctuation",
	syntaxRegex: "--syntax-regex",
	terminalBlack: "--terminal-black",
	terminalRed: "--terminal-red",
	terminalGreen: "--terminal-green",
	terminalYellow: "--terminal-yellow",
	terminalBlue: "--terminal-blue",
	terminalMagenta: "--terminal-magenta",
	terminalCyan: "--terminal-cyan",
	terminalWhite: "--terminal-white",
	terminalBrightBlack: "--terminal-bright-black",
	terminalBrightRed: "--terminal-bright-red",
	terminalBrightGreen: "--terminal-bright-green",
	terminalBrightYellow: "--terminal-bright-yellow",
	terminalBrightBlue: "--terminal-bright-blue",
	terminalBrightMagenta: "--terminal-bright-magenta",
	terminalBrightCyan: "--terminal-bright-cyan",
	terminalBrightWhite: "--terminal-bright-white",
}

// ────────────────────────────────────────────────────────────
// Color utilities for theme derivation
// ────────────────────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
	const h = hex.replace("#", "")
	return [
		Number.parseInt(h.slice(0, 2), 16),
		Number.parseInt(h.slice(2, 4), 16),
		Number.parseInt(h.slice(4, 6), 16),
	]
}

function rgbToHex(r: number, g: number, b: number): string {
	const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
	return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`
}

function mix(hex1: string, hex2: string, ratio: number): string {
	const [r1, g1, b1] = hexToRgb(hex1)
	const [r2, g2, b2] = hexToRgb(hex2)
	return rgbToHex(r1 + (r2 - r1) * ratio, g1 + (g2 - g1) * ratio, b1 + (b2 - b1) * ratio)
}

/** Core seed values for theme generation. Unspecified tokens are derived. */
interface ThemeSeed {
	background: string
	foreground: string
	accent: string
	muted?: string
	surface?: string
	border?: string
	success?: string
	warning?: string
	danger?: string
	// Syntax
	syntaxComment?: string
	syntaxString?: string
	syntaxKeyword?: string
	syntaxStorage?: string
	syntaxFunction?: string
	syntaxType?: string
	syntaxVariable?: string
	syntaxConstant?: string
	syntaxNumber?: string
	syntaxPunctuation?: string
	syntaxRegex?: string
	// Terminal ANSI (override defaults)
	terminalBlack?: string
	terminalRed?: string
	terminalGreen?: string
	terminalYellow?: string
	terminalBlue?: string
	terminalMagenta?: string
	terminalCyan?: string
	terminalWhite?: string
	terminalBrightBlack?: string
	terminalBrightRed?: string
	terminalBrightGreen?: string
	terminalBrightYellow?: string
	terminalBrightBlue?: string
	terminalBrightMagenta?: string
	terminalBrightCyan?: string
	terminalBrightWhite?: string
}

function buildTheme(
	id: string,
	name: string,
	variant: "dark" | "light",
	seed: ThemeSeed,
): ThemeDefinition {
	const { background: bg, foreground: fg, accent } = seed
	const isDark = variant === "dark"

	const surface = seed.surface ?? mix(bg, fg, isDark ? 0.06 : 0.04)
	const border = seed.border ?? mix(bg, fg, isDark ? 0.12 : 0.14)
	const muted = seed.muted ?? mix(bg, fg, 0.45)
	const success = seed.success ?? (isDark ? "#4ade80" : "#16a34a")
	const warning = seed.warning ?? (isDark ? "#fbbf24" : "#ca8a04")
	const danger = seed.danger ?? (isDark ? "#f87171" : "#dc2626")

	const colors: ThemeColors = {
		background: bg,
		foreground: fg,
		muted,
		surface,
		surfaceForeground: fg,
		overlay: isDark ? mix(bg, fg, 0.08) : bg,
		overlayForeground: fg,
		accent,
		accentForeground: "#ffffff",
		success,
		successForeground: "#ffffff",
		warning,
		warningForeground: isDark ? bg : "#ffffff",
		danger,
		dangerForeground: "#ffffff",
		default: mix(bg, fg, isDark ? 0.15 : 0.12),
		defaultForeground: fg,
		border,
		separator: border,
		scrollbar: mix(bg, fg, isDark ? 0.25 : 0.2),
		fieldBackground: surface,
		fieldForeground: fg,
		fieldBorder: mix(bg, fg, isDark ? 0.16 : 0.18),
		appMutedForeground: mix(bg, fg, isDark ? 0.5 : 0.45),
		appSurfaceHover: mix(bg, fg, isDark ? 0.1 : 0.08),
		appBubbleUser: mix(bg, fg, isDark ? 0.12 : 0.06),
		appInputSurface: surface,
		appInputBorder: mix(bg, fg, isDark ? 0.16 : 0.14),
		appCodeInline: mix(bg, fg, isDark ? 0.12 : 0.1),
		appCodeBlock: isDark ? mix(bg, "#000000", 0.3) : mix(bg, fg, 0.04),
		appSendEmptyBorder: mix(bg, fg, isDark ? 0.25 : 0.2),
		appSendEmptyText: mix(bg, fg, isDark ? 0.25 : 0.2),
		appSegmentBg: isDark ? mix(bg, "#000000", 0.3) : mix(bg, fg, 0.06),
		appPlaceholder: mix(bg, fg, isDark ? 0.3 : 0.35),
		appTerminalBg: isDark ? mix(bg, "#000000", 0.2) : mix(bg, fg, 0.08),
		syntaxForeground: fg,
		syntaxBackground: isDark ? mix(bg, "#000000", 0.3) : mix(bg, fg, 0.04),
		syntaxComment: seed.syntaxComment ?? (isDark ? "#6a9955" : "#008000"),
		syntaxString: seed.syntaxString ?? (isDark ? "#ce9178" : "#a31515"),
		syntaxKeyword: seed.syntaxKeyword ?? (isDark ? "#c586c0" : "#af00db"),
		syntaxStorage: seed.syntaxStorage ?? (isDark ? "#569cd6" : "#0000ff"),
		syntaxFunction: seed.syntaxFunction ?? (isDark ? "#dcdcaa" : "#795e26"),
		syntaxType: seed.syntaxType ?? (isDark ? "#4ec9b0" : "#267f99"),
		syntaxVariable: seed.syntaxVariable ?? (isDark ? "#9cdcfe" : "#001080"),
		syntaxConstant: seed.syntaxConstant ?? (isDark ? "#4fc1ff" : "#0070c1"),
		syntaxNumber: seed.syntaxNumber ?? (isDark ? "#b5cea8" : "#098658"),
		syntaxPunctuation: seed.syntaxPunctuation ?? mix(bg, fg, 0.45),
		syntaxRegex: seed.syntaxRegex ?? (isDark ? "#d16969" : "#811f3f"),
		// Terminal defaults
		terminalBlack: seed.terminalBlack ?? (isDark ? bg : "#1a1a1a"),
		terminalRed: seed.terminalRed ?? danger,
		terminalGreen: seed.terminalGreen ?? success,
		terminalYellow: seed.terminalYellow ?? warning,
		terminalBlue: seed.terminalBlue ?? accent,
		terminalMagenta: seed.terminalMagenta ?? (isDark ? "#c084fc" : "#9333ea"),
		terminalCyan: seed.terminalCyan ?? (isDark ? "#22d3ee" : "#0891b2"),
		terminalWhite: seed.terminalWhite ?? (isDark ? fg : "#e5e5e5"),
		terminalBrightBlack: seed.terminalBrightBlack ?? muted,
		terminalBrightRed: seed.terminalBrightRed ?? mix(danger, "#ffffff", 0.25),
		terminalBrightGreen: seed.terminalBrightGreen ?? mix(success, "#ffffff", 0.25),
		terminalBrightYellow: seed.terminalBrightYellow ?? mix(warning, "#ffffff", 0.25),
		terminalBrightBlue: seed.terminalBrightBlue ?? mix(accent, "#ffffff", 0.25),
		terminalBrightMagenta: seed.terminalBrightMagenta ?? (isDark ? "#d8b4fe" : "#a855f7"),
		terminalBrightCyan: seed.terminalBrightCyan ?? (isDark ? "#67e8f9" : "#06b6d4"),
		terminalBrightWhite: seed.terminalBrightWhite ?? "#ffffff",
	}

	return { id, name, variant, colors }
}

// ────────────────────────────────────────────────────────────
// Pre-built themes
// ────────────────────────────────────────────────────────────

export const DEFAULT_DARK_THEME_ID = "loop-dark"
export const DEFAULT_LIGHT_THEME_ID = "loop-light"

const loopDark = buildTheme("loop-dark", "Loop", "dark", {
	background: "#1e1e1e",
	foreground: "#d4d4d4",
	accent: "#4f8ff7",
	muted: "#858585",
	surface: "#262626",
	border: "#333333",
	syntaxComment: "#6a9955",
	syntaxString: "#ce9178",
	syntaxKeyword: "#c586c0",
	syntaxStorage: "#569cd6",
	syntaxFunction: "#dcdcaa",
	syntaxType: "#4ec9b0",
	syntaxVariable: "#9cdcfe",
	syntaxConstant: "#4fc1ff",
	syntaxNumber: "#b5cea8",
	syntaxPunctuation: "#808080",
	syntaxRegex: "#d16969",
	terminalBlack: "#1e1e1e",
	terminalRed: "#f87171",
	terminalGreen: "#4ade80",
	terminalYellow: "#fbbf24",
	terminalBlue: "#4f8ff7",
	terminalMagenta: "#c084fc",
	terminalCyan: "#22d3ee",
	terminalWhite: "#d4d4d4",
	terminalBrightBlack: "#858585",
	terminalBrightRed: "#fca5a5",
	terminalBrightGreen: "#86efac",
	terminalBrightYellow: "#fde68a",
	terminalBrightBlue: "#93c5fd",
	terminalBrightMagenta: "#d8b4fe",
	terminalBrightCyan: "#67e8f9",
	terminalBrightWhite: "#ffffff",
})

const loopLight = buildTheme("loop-light", "Loop", "light", {
	background: "#ffffff",
	foreground: "#1a1a1a",
	accent: "#2563eb",
	muted: "#888888",
	surface: "#f5f5f5",
	border: "#e5e5e5",
	syntaxComment: "#008000",
	syntaxString: "#a31515",
	syntaxKeyword: "#af00db",
	syntaxStorage: "#0000ff",
	syntaxFunction: "#795e26",
	syntaxType: "#267f99",
	syntaxVariable: "#001080",
	syntaxConstant: "#0070c1",
	syntaxNumber: "#098658",
	syntaxPunctuation: "#393a34",
	syntaxRegex: "#811f3f",
	terminalBlack: "#1a1a1a",
	terminalRed: "#dc2626",
	terminalGreen: "#16a34a",
	terminalYellow: "#ca8a04",
	terminalBlue: "#2563eb",
	terminalMagenta: "#9333ea",
	terminalCyan: "#0891b2",
	terminalWhite: "#e5e5e5",
	terminalBrightBlack: "#888888",
	terminalBrightRed: "#ef4444",
	terminalBrightGreen: "#22c55e",
	terminalBrightYellow: "#eab308",
	terminalBrightBlue: "#3b82f6",
	terminalBrightMagenta: "#a855f7",
	terminalBrightCyan: "#06b6d4",
	terminalBrightWhite: "#ffffff",
})

const draculaDark = buildTheme("dracula-dark", "Dracula", "dark", {
	background: "#282a36",
	foreground: "#f8f8f2",
	accent: "#bd93f9",
	muted: "#6272a4",
	surface: "#343746",
	border: "#44475a",
	success: "#50fa7b",
	warning: "#f1fa8c",
	danger: "#ff5555",
	syntaxComment: "#6272a4",
	syntaxString: "#f1fa8c",
	syntaxKeyword: "#ff79c6",
	syntaxStorage: "#bd93f9",
	syntaxFunction: "#50fa7b",
	syntaxType: "#8be9fd",
	syntaxVariable: "#f8f8f2",
	syntaxConstant: "#bd93f9",
	syntaxNumber: "#bd93f9",
	syntaxPunctuation: "#f8f8f2",
	syntaxRegex: "#ff5555",
	terminalBlack: "#21222c",
	terminalRed: "#ff5555",
	terminalGreen: "#50fa7b",
	terminalYellow: "#f1fa8c",
	terminalBlue: "#bd93f9",
	terminalMagenta: "#ff79c6",
	terminalCyan: "#8be9fd",
	terminalWhite: "#f8f8f2",
	terminalBrightBlack: "#6272a4",
	terminalBrightRed: "#ff6e6e",
	terminalBrightGreen: "#69ff94",
	terminalBrightYellow: "#ffffa5",
	terminalBrightBlue: "#d6acff",
	terminalBrightMagenta: "#ff92df",
	terminalBrightCyan: "#a4ffff",
	terminalBrightWhite: "#ffffff",
})

const catppuccinMocha = buildTheme("catppuccin-mocha", "Catppuccin", "dark", {
	background: "#1e1e2e",
	foreground: "#cdd6f4",
	accent: "#89b4fa",
	muted: "#6c7086",
	surface: "#313244",
	border: "#45475a",
	success: "#a6e3a1",
	warning: "#f9e2af",
	danger: "#f38ba8",
	syntaxComment: "#6c7086",
	syntaxString: "#a6e3a1",
	syntaxKeyword: "#cba6f7",
	syntaxStorage: "#89b4fa",
	syntaxFunction: "#89b4fa",
	syntaxType: "#f9e2af",
	syntaxVariable: "#cdd6f4",
	syntaxConstant: "#fab387",
	syntaxNumber: "#fab387",
	syntaxPunctuation: "#9399b2",
	syntaxRegex: "#f38ba8",
	terminalBlack: "#45475a",
	terminalRed: "#f38ba8",
	terminalGreen: "#a6e3a1",
	terminalYellow: "#f9e2af",
	terminalBlue: "#89b4fa",
	terminalMagenta: "#cba6f7",
	terminalCyan: "#94e2d5",
	terminalWhite: "#bac2de",
	terminalBrightBlack: "#585b70",
	terminalBrightRed: "#f38ba8",
	terminalBrightGreen: "#a6e3a1",
	terminalBrightYellow: "#f9e2af",
	terminalBrightBlue: "#89b4fa",
	terminalBrightMagenta: "#cba6f7",
	terminalBrightCyan: "#94e2d5",
	terminalBrightWhite: "#a6adc8",
})

const catppuccinLatte = buildTheme("catppuccin-latte", "Catppuccin", "light", {
	background: "#eff1f5",
	foreground: "#4c4f69",
	accent: "#1e66f5",
	muted: "#9ca0b0",
	surface: "#e6e9ef",
	border: "#ccd0da",
	success: "#40a02b",
	warning: "#df8e1d",
	danger: "#d20f39",
	syntaxComment: "#9ca0b0",
	syntaxString: "#40a02b",
	syntaxKeyword: "#8839ef",
	syntaxStorage: "#1e66f5",
	syntaxFunction: "#1e66f5",
	syntaxType: "#df8e1d",
	syntaxVariable: "#4c4f69",
	syntaxConstant: "#fe640b",
	syntaxNumber: "#fe640b",
	syntaxPunctuation: "#5c5f77",
	syntaxRegex: "#d20f39",
	terminalBlack: "#5c5f77",
	terminalRed: "#d20f39",
	terminalGreen: "#40a02b",
	terminalYellow: "#df8e1d",
	terminalBlue: "#1e66f5",
	terminalMagenta: "#8839ef",
	terminalCyan: "#179299",
	terminalWhite: "#acb0be",
	terminalBrightBlack: "#6c6f85",
	terminalBrightRed: "#d20f39",
	terminalBrightGreen: "#40a02b",
	terminalBrightYellow: "#df8e1d",
	terminalBrightBlue: "#1e66f5",
	terminalBrightMagenta: "#8839ef",
	terminalBrightCyan: "#179299",
	terminalBrightWhite: "#bcc0cc",
})

const gruvboxDark = buildTheme("gruvbox-dark", "Gruvbox", "dark", {
	background: "#282828",
	foreground: "#ebdbb2",
	accent: "#fabd2f",
	muted: "#928374",
	surface: "#3c3836",
	border: "#504945",
	success: "#b8bb26",
	warning: "#fabd2f",
	danger: "#fb4934",
	syntaxComment: "#928374",
	syntaxString: "#b8bb26",
	syntaxKeyword: "#fb4934",
	syntaxStorage: "#83a598",
	syntaxFunction: "#b8bb26",
	syntaxType: "#fabd2f",
	syntaxVariable: "#ebdbb2",
	syntaxConstant: "#d3869b",
	syntaxNumber: "#d3869b",
	syntaxPunctuation: "#a89984",
	syntaxRegex: "#fe8019",
	terminalBlack: "#282828",
	terminalRed: "#cc241d",
	terminalGreen: "#98971a",
	terminalYellow: "#d79921",
	terminalBlue: "#458588",
	terminalMagenta: "#b16286",
	terminalCyan: "#689d6a",
	terminalWhite: "#a89984",
	terminalBrightBlack: "#928374",
	terminalBrightRed: "#fb4934",
	terminalBrightGreen: "#b8bb26",
	terminalBrightYellow: "#fabd2f",
	terminalBrightBlue: "#83a598",
	terminalBrightMagenta: "#d3869b",
	terminalBrightCyan: "#8ec07c",
	terminalBrightWhite: "#ebdbb2",
})

const gruvboxLight = buildTheme("gruvbox-light", "Gruvbox", "light", {
	background: "#fbf1c7",
	foreground: "#3c3836",
	accent: "#d79921",
	muted: "#928374",
	surface: "#f2e5bc",
	border: "#d5c4a1",
	success: "#98971a",
	warning: "#d79921",
	danger: "#cc241d",
	syntaxComment: "#928374",
	syntaxString: "#98971a",
	syntaxKeyword: "#cc241d",
	syntaxStorage: "#458588",
	syntaxFunction: "#98971a",
	syntaxType: "#d79921",
	syntaxVariable: "#3c3836",
	syntaxConstant: "#b16286",
	syntaxNumber: "#b16286",
	syntaxPunctuation: "#7c6f64",
	syntaxRegex: "#d65d0e",
	terminalBlack: "#3c3836",
	terminalRed: "#cc241d",
	terminalGreen: "#98971a",
	terminalYellow: "#d79921",
	terminalBlue: "#458588",
	terminalMagenta: "#b16286",
	terminalCyan: "#689d6a",
	terminalWhite: "#d5c4a1",
	terminalBrightBlack: "#928374",
	terminalBrightRed: "#9d0006",
	terminalBrightGreen: "#79740e",
	terminalBrightYellow: "#b57614",
	terminalBrightBlue: "#076678",
	terminalBrightMagenta: "#8f3f71",
	terminalBrightCyan: "#427b58",
	terminalBrightWhite: "#fbf1c7",
})

const githubDark = buildTheme("github-dark", "GitHub", "dark", {
	background: "#0d1117",
	foreground: "#c9d1d9",
	accent: "#58a6ff",
	muted: "#8b949e",
	surface: "#161b22",
	border: "#30363d",
	success: "#3fb950",
	warning: "#d29922",
	danger: "#f85149",
	syntaxComment: "#8b949e",
	syntaxString: "#a5d6ff",
	syntaxKeyword: "#ff7b72",
	syntaxStorage: "#ff7b72",
	syntaxFunction: "#d2a8ff",
	syntaxType: "#79c0ff",
	syntaxVariable: "#ffa657",
	syntaxConstant: "#79c0ff",
	syntaxNumber: "#79c0ff",
	syntaxPunctuation: "#c9d1d9",
	syntaxRegex: "#7ee787",
	terminalBlack: "#0d1117",
	terminalRed: "#ff7b72",
	terminalGreen: "#3fb950",
	terminalYellow: "#d29922",
	terminalBlue: "#58a6ff",
	terminalMagenta: "#bc8cff",
	terminalCyan: "#39c5cf",
	terminalWhite: "#b1bac4",
	terminalBrightBlack: "#6e7681",
	terminalBrightRed: "#ffa198",
	terminalBrightGreen: "#56d364",
	terminalBrightYellow: "#e3b341",
	terminalBrightBlue: "#79c0ff",
	terminalBrightMagenta: "#d2a8ff",
	terminalBrightCyan: "#56d4dd",
	terminalBrightWhite: "#f0f6fc",
})

const githubLight = buildTheme("github-light", "GitHub", "light", {
	background: "#ffffff",
	foreground: "#24292f",
	accent: "#0969da",
	muted: "#6e7781",
	surface: "#f6f8fa",
	border: "#d0d7de",
	success: "#1a7f37",
	warning: "#9a6700",
	danger: "#cf222e",
	syntaxComment: "#6e7781",
	syntaxString: "#0a3069",
	syntaxKeyword: "#cf222e",
	syntaxStorage: "#cf222e",
	syntaxFunction: "#8250df",
	syntaxType: "#0550ae",
	syntaxVariable: "#953800",
	syntaxConstant: "#0550ae",
	syntaxNumber: "#0550ae",
	syntaxPunctuation: "#24292f",
	syntaxRegex: "#116329",
	terminalBlack: "#24292f",
	terminalRed: "#cf222e",
	terminalGreen: "#1a7f37",
	terminalYellow: "#9a6700",
	terminalBlue: "#0969da",
	terminalMagenta: "#8250df",
	terminalCyan: "#1b7c83",
	terminalWhite: "#d0d7de",
	terminalBrightBlack: "#57606a",
	terminalBrightRed: "#a40e26",
	terminalBrightGreen: "#2da44e",
	terminalBrightYellow: "#bf8700",
	terminalBrightBlue: "#218bff",
	terminalBrightMagenta: "#a475f9",
	terminalBrightCyan: "#3192aa",
	terminalBrightWhite: "#ffffff",
})

const ayuDark = buildTheme("ayu-dark", "Ayu", "dark", {
	background: "#0b0e14",
	foreground: "#bfbdb6",
	accent: "#e6b450",
	muted: "#636a76",
	surface: "#131721",
	border: "#1c2028",
	success: "#7fd962",
	warning: "#e6b450",
	danger: "#d95757",
	syntaxComment: "#636a76",
	syntaxString: "#aad94c",
	syntaxKeyword: "#ff8f40",
	syntaxStorage: "#59c2ff",
	syntaxFunction: "#ffb454",
	syntaxType: "#59c2ff",
	syntaxVariable: "#bfbdb6",
	syntaxConstant: "#d2a6ff",
	syntaxNumber: "#d2a6ff",
	syntaxPunctuation: "#bfbdb680",
	syntaxRegex: "#95e6cb",
	terminalBlack: "#0b0e14",
	terminalRed: "#d95757",
	terminalGreen: "#7fd962",
	terminalYellow: "#e6b450",
	terminalBlue: "#59c2ff",
	terminalMagenta: "#d2a6ff",
	terminalCyan: "#95e6cb",
	terminalWhite: "#bfbdb6",
	terminalBrightBlack: "#636a76",
	terminalBrightRed: "#f07171",
	terminalBrightGreen: "#aad94c",
	terminalBrightYellow: "#ffb454",
	terminalBrightBlue: "#73d0ff",
	terminalBrightMagenta: "#dfbfff",
	terminalBrightCyan: "#95e6cb",
	terminalBrightWhite: "#ffffff",
})

const ayuLight = buildTheme("ayu-light", "Ayu", "light", {
	background: "#fafafa",
	foreground: "#575f66",
	accent: "#ff9940",
	muted: "#abb0b6",
	surface: "#f0f0f0",
	border: "#e1e1e2",
	success: "#86b300",
	warning: "#f29718",
	danger: "#f07171",
	syntaxComment: "#abb0b6",
	syntaxString: "#86b300",
	syntaxKeyword: "#fa8d3e",
	syntaxStorage: "#399ee6",
	syntaxFunction: "#f2ae49",
	syntaxType: "#399ee6",
	syntaxVariable: "#575f66",
	syntaxConstant: "#a37acc",
	syntaxNumber: "#a37acc",
	syntaxPunctuation: "#575f6680",
	syntaxRegex: "#4cbf99",
	terminalBlack: "#575f66",
	terminalRed: "#f07171",
	terminalGreen: "#86b300",
	terminalYellow: "#f29718",
	terminalBlue: "#399ee6",
	terminalMagenta: "#a37acc",
	terminalCyan: "#4cbf99",
	terminalWhite: "#e1e1e2",
	terminalBrightBlack: "#828c99",
	terminalBrightRed: "#f07171",
	terminalBrightGreen: "#86b300",
	terminalBrightYellow: "#f29718",
	terminalBrightBlue: "#399ee6",
	terminalBrightMagenta: "#a37acc",
	terminalBrightCyan: "#4cbf99",
	terminalBrightWhite: "#fafafa",
})

const everforestDark = buildTheme("everforest-dark", "Everforest", "dark", {
	background: "#2d353b",
	foreground: "#d3c6aa",
	accent: "#a7c080",
	muted: "#859289",
	surface: "#343f44",
	border: "#4a555b",
	success: "#a7c080",
	warning: "#dbbc7f",
	danger: "#e67e80",
	syntaxComment: "#859289",
	syntaxString: "#a7c080",
	syntaxKeyword: "#e67e80",
	syntaxStorage: "#7fbbb3",
	syntaxFunction: "#a7c080",
	syntaxType: "#dbbc7f",
	syntaxVariable: "#d3c6aa",
	syntaxConstant: "#d699b6",
	syntaxNumber: "#d699b6",
	syntaxPunctuation: "#859289",
	syntaxRegex: "#e69875",
	terminalBlack: "#2d353b",
	terminalRed: "#e67e80",
	terminalGreen: "#a7c080",
	terminalYellow: "#dbbc7f",
	terminalBlue: "#7fbbb3",
	terminalMagenta: "#d699b6",
	terminalCyan: "#83c092",
	terminalWhite: "#d3c6aa",
	terminalBrightBlack: "#859289",
	terminalBrightRed: "#e67e80",
	terminalBrightGreen: "#a7c080",
	terminalBrightYellow: "#dbbc7f",
	terminalBrightBlue: "#7fbbb3",
	terminalBrightMagenta: "#d699b6",
	terminalBrightCyan: "#83c092",
	terminalBrightWhite: "#fdf6e3",
})

const everforestLight = buildTheme("everforest-light", "Everforest", "light", {
	background: "#fdf6e3",
	foreground: "#5c6a72",
	accent: "#8da101",
	muted: "#939f91",
	surface: "#f4f0d9",
	border: "#e0dcc7",
	success: "#8da101",
	warning: "#dfa000",
	danger: "#f85552",
	syntaxComment: "#939f91",
	syntaxString: "#8da101",
	syntaxKeyword: "#f85552",
	syntaxStorage: "#3a94c5",
	syntaxFunction: "#8da101",
	syntaxType: "#dfa000",
	syntaxVariable: "#5c6a72",
	syntaxConstant: "#df69ba",
	syntaxNumber: "#df69ba",
	syntaxPunctuation: "#939f91",
	syntaxRegex: "#e66868",
	terminalBlack: "#5c6a72",
	terminalRed: "#f85552",
	terminalGreen: "#8da101",
	terminalYellow: "#dfa000",
	terminalBlue: "#3a94c5",
	terminalMagenta: "#df69ba",
	terminalCyan: "#35a77c",
	terminalWhite: "#dfdbc8",
	terminalBrightBlack: "#939f91",
	terminalBrightRed: "#f85552",
	terminalBrightGreen: "#8da101",
	terminalBrightYellow: "#dfa000",
	terminalBrightBlue: "#3a94c5",
	terminalBrightMagenta: "#df69ba",
	terminalBrightCyan: "#35a77c",
	terminalBrightWhite: "#fdf6e3",
})

const oneDark = buildTheme("one-dark", "One Dark", "dark", {
	background: "#282c34",
	foreground: "#abb2bf",
	accent: "#61afef",
	muted: "#5c6370",
	surface: "#2c313c",
	border: "#3e4452",
	success: "#98c379",
	warning: "#e5c07b",
	danger: "#e06c75",
	syntaxComment: "#5c6370",
	syntaxString: "#98c379",
	syntaxKeyword: "#c678dd",
	syntaxStorage: "#c678dd",
	syntaxFunction: "#61afef",
	syntaxType: "#e5c07b",
	syntaxVariable: "#e06c75",
	syntaxConstant: "#d19a66",
	syntaxNumber: "#d19a66",
	syntaxPunctuation: "#abb2bf",
	syntaxRegex: "#56b6c2",
	terminalBlack: "#282c34",
	terminalRed: "#e06c75",
	terminalGreen: "#98c379",
	terminalYellow: "#e5c07b",
	terminalBlue: "#61afef",
	terminalMagenta: "#c678dd",
	terminalCyan: "#56b6c2",
	terminalWhite: "#abb2bf",
	terminalBrightBlack: "#5c6370",
	terminalBrightRed: "#e06c75",
	terminalBrightGreen: "#98c379",
	terminalBrightYellow: "#e5c07b",
	terminalBrightBlue: "#61afef",
	terminalBrightMagenta: "#c678dd",
	terminalBrightCyan: "#56b6c2",
	terminalBrightWhite: "#ffffff",
})

const oneLight = buildTheme("one-light", "One Light", "light", {
	background: "#fafafa",
	foreground: "#383a42",
	accent: "#4078f2",
	muted: "#a0a1a7",
	surface: "#f0f0f0",
	border: "#e0e0e0",
	success: "#50a14f",
	warning: "#c18401",
	danger: "#e45649",
	syntaxComment: "#a0a1a7",
	syntaxString: "#50a14f",
	syntaxKeyword: "#a626a4",
	syntaxStorage: "#a626a4",
	syntaxFunction: "#4078f2",
	syntaxType: "#c18401",
	syntaxVariable: "#e45649",
	syntaxConstant: "#986801",
	syntaxNumber: "#986801",
	syntaxPunctuation: "#383a42",
	syntaxRegex: "#0184bc",
	terminalBlack: "#383a42",
	terminalRed: "#e45649",
	terminalGreen: "#50a14f",
	terminalYellow: "#c18401",
	terminalBlue: "#4078f2",
	terminalMagenta: "#a626a4",
	terminalCyan: "#0184bc",
	terminalWhite: "#e0e0e0",
	terminalBrightBlack: "#a0a1a7",
	terminalBrightRed: "#e45649",
	terminalBrightGreen: "#50a14f",
	terminalBrightYellow: "#c18401",
	terminalBrightBlue: "#4078f2",
	terminalBrightMagenta: "#a626a4",
	terminalBrightCyan: "#0184bc",
	terminalBrightWhite: "#fafafa",
})

const nordDark = buildTheme("nord-dark", "Nord", "dark", {
	background: "#2e3440",
	foreground: "#d8dee9",
	accent: "#88c0d0",
	muted: "#616e88",
	surface: "#3b4252",
	border: "#434c5e",
	success: "#a3be8c",
	warning: "#ebcb8b",
	danger: "#bf616a",
	syntaxComment: "#616e88",
	syntaxString: "#a3be8c",
	syntaxKeyword: "#81a1c1",
	syntaxStorage: "#81a1c1",
	syntaxFunction: "#88c0d0",
	syntaxType: "#8fbcbb",
	syntaxVariable: "#d8dee9",
	syntaxConstant: "#b48ead",
	syntaxNumber: "#b48ead",
	syntaxPunctuation: "#81a1c1",
	syntaxRegex: "#ebcb8b",
	terminalBlack: "#3b4252",
	terminalRed: "#bf616a",
	terminalGreen: "#a3be8c",
	terminalYellow: "#ebcb8b",
	terminalBlue: "#81a1c1",
	terminalMagenta: "#b48ead",
	terminalCyan: "#88c0d0",
	terminalWhite: "#e5e9f0",
	terminalBrightBlack: "#4c566a",
	terminalBrightRed: "#bf616a",
	terminalBrightGreen: "#a3be8c",
	terminalBrightYellow: "#ebcb8b",
	terminalBrightBlue: "#81a1c1",
	terminalBrightMagenta: "#b48ead",
	terminalBrightCyan: "#8fbcbb",
	terminalBrightWhite: "#eceff4",
})

const tokyoNightDark = buildTheme("tokyo-night-dark", "Tokyo Night", "dark", {
	background: "#1a1b26",
	foreground: "#a9b1d6",
	accent: "#7aa2f7",
	muted: "#565f89",
	surface: "#24283b",
	border: "#292e42",
	success: "#9ece6a",
	warning: "#e0af68",
	danger: "#f7768e",
	syntaxComment: "#565f89",
	syntaxString: "#9ece6a",
	syntaxKeyword: "#bb9af7",
	syntaxStorage: "#bb9af7",
	syntaxFunction: "#7aa2f7",
	syntaxType: "#2ac3de",
	syntaxVariable: "#c0caf5",
	syntaxConstant: "#ff9e64",
	syntaxNumber: "#ff9e64",
	syntaxPunctuation: "#9aa5ce",
	syntaxRegex: "#b4f9f8",
	terminalBlack: "#1a1b26",
	terminalRed: "#f7768e",
	terminalGreen: "#9ece6a",
	terminalYellow: "#e0af68",
	terminalBlue: "#7aa2f7",
	terminalMagenta: "#bb9af7",
	terminalCyan: "#7dcfff",
	terminalWhite: "#a9b1d6",
	terminalBrightBlack: "#565f89",
	terminalBrightRed: "#f7768e",
	terminalBrightGreen: "#9ece6a",
	terminalBrightYellow: "#e0af68",
	terminalBrightBlue: "#7aa2f7",
	terminalBrightMagenta: "#bb9af7",
	terminalBrightCyan: "#7dcfff",
	terminalBrightWhite: "#c0caf5",
})

const rosePineDark = buildTheme("rose-pine-dark", "Rose Pine", "dark", {
	background: "#191724",
	foreground: "#e0def4",
	accent: "#c4a7e7",
	muted: "#6e6a86",
	surface: "#1f1d2e",
	border: "#26233a",
	success: "#9ccfd8",
	warning: "#f6c177",
	danger: "#eb6f92",
	syntaxComment: "#6e6a86",
	syntaxString: "#f6c177",
	syntaxKeyword: "#31748f",
	syntaxStorage: "#c4a7e7",
	syntaxFunction: "#ebbcba",
	syntaxType: "#9ccfd8",
	syntaxVariable: "#e0def4",
	syntaxConstant: "#c4a7e7",
	syntaxNumber: "#c4a7e7",
	syntaxPunctuation: "#908caa",
	syntaxRegex: "#eb6f92",
	terminalBlack: "#26233a",
	terminalRed: "#eb6f92",
	terminalGreen: "#9ccfd8",
	terminalYellow: "#f6c177",
	terminalBlue: "#31748f",
	terminalMagenta: "#c4a7e7",
	terminalCyan: "#9ccfd8",
	terminalWhite: "#e0def4",
	terminalBrightBlack: "#6e6a86",
	terminalBrightRed: "#eb6f92",
	terminalBrightGreen: "#9ccfd8",
	terminalBrightYellow: "#f6c177",
	terminalBrightBlue: "#31748f",
	terminalBrightMagenta: "#c4a7e7",
	terminalBrightCyan: "#9ccfd8",
	terminalBrightWhite: "#e0def4",
})

const rosePineLight = buildTheme("rose-pine-light", "Rose Pine", "light", {
	background: "#faf4ed",
	foreground: "#575279",
	accent: "#907aa9",
	muted: "#9893a5",
	surface: "#fffaf3",
	border: "#f2e9e1",
	success: "#56949f",
	warning: "#ea9d34",
	danger: "#b4637a",
	syntaxComment: "#9893a5",
	syntaxString: "#ea9d34",
	syntaxKeyword: "#286983",
	syntaxStorage: "#907aa9",
	syntaxFunction: "#d7827e",
	syntaxType: "#56949f",
	syntaxVariable: "#575279",
	syntaxConstant: "#907aa9",
	syntaxNumber: "#907aa9",
	syntaxPunctuation: "#797593",
	syntaxRegex: "#b4637a",
	terminalBlack: "#575279",
	terminalRed: "#b4637a",
	terminalGreen: "#56949f",
	terminalYellow: "#ea9d34",
	terminalBlue: "#286983",
	terminalMagenta: "#907aa9",
	terminalCyan: "#56949f",
	terminalWhite: "#f2e9e1",
	terminalBrightBlack: "#9893a5",
	terminalBrightRed: "#b4637a",
	terminalBrightGreen: "#56949f",
	terminalBrightYellow: "#ea9d34",
	terminalBrightBlue: "#286983",
	terminalBrightMagenta: "#907aa9",
	terminalBrightCyan: "#56949f",
	terminalBrightWhite: "#faf4ed",
})

// ────────────────────────────────────────────────────────────
// Theme registry
// ────────────────────────────────────────────────────────────

export const THEMES: ThemeDefinition[] = [
	loopDark,
	loopLight,
	draculaDark,
	catppuccinMocha,
	catppuccinLatte,
	gruvboxDark,
	gruvboxLight,
	githubDark,
	githubLight,
	ayuDark,
	ayuLight,
	everforestDark,
	everforestLight,
	oneDark,
	oneLight,
	nordDark,
	tokyoNightDark,
	rosePineDark,
	rosePineLight,
]

export const DARK_THEMES = THEMES.filter((t) => t.variant === "dark")
export const LIGHT_THEMES = THEMES.filter((t) => t.variant === "light")

const themeMap = new Map(THEMES.map((t) => [t.id, t]))

export function getTheme(id: string): ThemeDefinition | undefined {
	return themeMap.get(id)
}
