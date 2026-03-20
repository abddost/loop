// ────────────────────────────────────────────────────────────
// Theme engine — bridges theme data to live CSS variables
// ────────────────────────────────────────────────────────────

import type { Appearance } from "@core/schema/config"
import {
	DEFAULT_DARK_THEME_ID,
	DEFAULT_LIGHT_THEME_ID,
	TOKEN_TO_VAR,
	type ThemeColors,
	getTheme,
} from "@core/schema/theme"
import { findFont, getFontStack, loadFont } from "./font-loader"

// ────────────────────────────────────────────────────────────
// Mode resolution
// ────────────────────────────────────────────────────────────

const darkMediaQuery =
	typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null

/** Resolve "system" mode to "dark" or "light" based on OS preference. */
export function resolveEffectiveMode(mode: "dark" | "light" | "system"): "dark" | "light" {
	if (mode !== "system") return mode
	return darkMediaQuery?.matches ? "dark" : "light"
}

// ────────────────────────────────────────────────────────────
// Color utilities
// ────────────────────────────────────────────────────────────

function hexToHsl(hex: string): [number, number, number] {
	const h = hex.replace("#", "")
	const r = Number.parseInt(h.slice(0, 2), 16) / 255
	const g = Number.parseInt(h.slice(2, 4), 16) / 255
	const b = Number.parseInt(h.slice(4, 6), 16) / 255

	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	const l = (max + min) / 2

	if (max === min) return [0, 0, l]

	const d = max - min
	const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
	let hue = 0
	if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6
	else if (max === g) hue = ((b - r) / d + 2) / 6
	else hue = ((r - g) / d + 4) / 6

	return [hue, s, l]
}

function hslToHex(h: number, s: number, l: number): string {
	const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)))

	if (s === 0) {
		const v = clamp(l)
		return `#${v.toString(16).padStart(2, "0")}${v.toString(16).padStart(2, "0")}${v.toString(16).padStart(2, "0")}`
	}

	const hue2rgb = (p: number, q: number, raw: number) => {
		const t = raw < 0 ? raw + 1 : raw > 1 ? raw - 1 : raw
		if (t < 1 / 6) return p + (q - p) * 6 * t
		if (t < 1 / 2) return q
		if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
		return p
	}

	const q = l < 0.5 ? l * (1 + s) : l + s - l * s
	const p = 2 * l - q
	const r = clamp(hue2rgb(p, q, h + 1 / 3))
	const g = clamp(hue2rgb(p, q, h))
	const b = clamp(hue2rgb(p, q, h - 1 / 3))

	return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
}

/** Adjust lightness of a hex color. amount: 0..1 range shift. */
function adjustLightness(hex: string, amount: number): string {
	if (!hex || hex.length < 7) return hex
	const [h, s, l] = hexToHsl(hex)
	return hslToHex(h, s, Math.max(0, Math.min(1, l + amount)))
}

/** Tokens affected by contrast adjustment. */
const CONTRAST_TOKENS: (keyof ThemeColors)[] = [
	"background",
	"surface",
	"overlay",
	"appCodeBlock",
	"appTerminalBg",
	"appSegmentBg",
	"syntaxBackground",
	"fieldBackground",
]

// ────────────────────────────────────────────────────────────
// Apply theme
// ────────────────────────────────────────────────────────────

/**
 * Apply mode class + data-theme attribute.
 * Needed for HeroUI compatibility and CSS fallback selectors.
 */
function applyMode(resolved: "dark" | "light"): void {
	const root = document.documentElement
	root.classList.toggle("dark", resolved === "dark")
	root.classList.toggle("light", resolved === "light")
	root.setAttribute("data-theme", resolved)
}

/**
 * Apply all theme colors as CSS custom properties on the document root.
 * Applies colorOverrides on top, then contrast adjustment.
 */
function applyColors(
	colors: ThemeColors,
	overrides: Record<string, string>,
	contrast: number,
	variant: "dark" | "light",
): void {
	const root = document.documentElement
	const merged = { ...colors }

	// Apply user color overrides
	for (const [key, value] of Object.entries(overrides)) {
		if (key in TOKEN_TO_VAR && value) {
			;(merged as Record<string, string>)[key] = value
		}
	}

	// Apply contrast adjustment (0=low, 50=default, 100=high)
	const contrastShift = ((contrast - 50) / 50) * 0.08
	if (contrastShift !== 0) {
		const direction = variant === "dark" ? -1 : 1
		for (const token of CONTRAST_TOKENS) {
			const val = merged[token]
			if (val?.startsWith("#")) {
				;(merged as Record<string, string>)[token] = adjustLightness(val, contrastShift * direction)
			}
		}
	}

	// Set all CSS variables
	for (const [key, varName] of Object.entries(TOKEN_TO_VAR)) {
		const value = (merged as Record<string, string>)[key]
		if (value) {
			root.style.setProperty(varName, value)
		}
	}
}

/**
 * Apply font family + size CSS variables.
 * Triggers lazy Google Fonts loading if needed.
 */
function applyFonts(
	uiFontId: string | null,
	codeFontId: string | null,
	uiFontSize: number,
	codeFontSize: number,
): void {
	const root = document.documentElement

	// Trigger font loading
	const uiEntry = findFont(uiFontId, "sans")
	const codeEntry = findFont(codeFontId, "mono")
	if (uiEntry?.googleId) loadFont(uiEntry.googleId)
	if (codeEntry?.googleId) loadFont(codeEntry.googleId)

	root.style.setProperty("--font-ui", getFontStack(uiFontId, "sans"))
	root.style.setProperty("--font-mono", getFontStack(codeFontId, "mono"))
	root.style.setProperty("--font-ui-size", `${uiFontSize}px`)
	root.style.setProperty("--font-code-size", `${codeFontSize}px`)
}

/** Toggle translucent sidebar data attribute. */
function applySidebarTranslucency(enabled: boolean): void {
	document.documentElement.toggleAttribute("data-translucent-sidebar", enabled)
}

// ────────────────────────────────────────────────────────────
// Terminal theme
// ────────────────────────────────────────────────────────────

/** Build an xterm.js ITheme from theme colors. */
export function getTerminalColors(colors: ThemeColors): Record<string, string> {
	return {
		background: colors.appTerminalBg,
		foreground: colors.foreground,
		cursor: colors.foreground,
		cursorAccent: colors.appTerminalBg,
		selectionBackground: `${colors.accent}40`,
		black: colors.terminalBlack,
		red: colors.terminalRed,
		green: colors.terminalGreen,
		yellow: colors.terminalYellow,
		blue: colors.terminalBlue,
		magenta: colors.terminalMagenta,
		cyan: colors.terminalCyan,
		white: colors.terminalWhite,
		brightBlack: colors.terminalBrightBlack,
		brightRed: colors.terminalBrightRed,
		brightGreen: colors.terminalBrightGreen,
		brightYellow: colors.terminalBrightYellow,
		brightBlue: colors.terminalBrightBlue,
		brightMagenta: colors.terminalBrightMagenta,
		brightCyan: colors.terminalBrightCyan,
		brightWhite: colors.terminalBrightWhite,
	}
}

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

let systemThemeCleanup: (() => void) | null = null

/**
 * Resolve the active ThemeColors from appearance config.
 * Returns the theme colors with the correct variant applied.
 */
export function resolveThemeColors(appearance: Appearance): {
	colors: ThemeColors
	variant: "dark" | "light"
} {
	const resolved = resolveEffectiveMode(appearance.mode)
	const themeId = resolved === "dark" ? appearance.darkTheme : appearance.lightTheme
	const fallbackId = resolved === "dark" ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID
	const theme = getTheme(themeId) ?? getTheme(fallbackId)!
	return { colors: theme.colors, variant: resolved }
}

/**
 * Apply full appearance config: mode, theme, colors, fonts, sidebar.
 * Call whenever the appearance config changes.
 */
export function applyAppearance(appearance: Appearance): void {
	const resolved = resolveEffectiveMode(appearance.mode)
	const themeId = resolved === "dark" ? appearance.darkTheme : appearance.lightTheme
	const fallbackId = resolved === "dark" ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID
	const theme = getTheme(themeId) ?? getTheme(fallbackId)!

	applyMode(resolved)
	const overrides =
		resolved === "dark" ? appearance.darkColorOverrides : appearance.lightColorOverrides
	applyColors(theme.colors, overrides, appearance.contrast, resolved)
	applyFonts(appearance.uiFont, appearance.codeFont, appearance.uiFontSize, appearance.codeFontSize)
	applySidebarTranslucency(appearance.translucentSidebar)
}

/**
 * Initialize the theme engine at app startup.
 * Installs system theme change listener if mode is "system".
 */
export function initThemeEngine(appearance: Appearance): void {
	applyAppearance(appearance)
	installSystemListener(appearance)
}

/** Install/reinstall the system theme change listener. */
function installSystemListener(appearance: Appearance): void {
	// Clean up previous listener
	if (systemThemeCleanup) {
		systemThemeCleanup()
		systemThemeCleanup = null
	}

	if (appearance.mode !== "system" || !darkMediaQuery) return

	const handler = () => applyAppearance(appearance)
	darkMediaQuery.addEventListener("change", handler)
	systemThemeCleanup = () => darkMediaQuery.removeEventListener("change", handler)
}

/**
 * Update the system listener with new appearance config.
 * Call after appearance updates to keep the listener in sync.
 */
export function updateSystemListener(appearance: Appearance): void {
	installSystemListener(appearance)
}
