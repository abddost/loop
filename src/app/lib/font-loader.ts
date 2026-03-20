// ────────────────────────────────────────────────────────────
// Lazy Google Fonts loader + font catalog
// ────────────────────────────────────────────────────────────

export interface FontEntry {
	id: string
	name: string
	/** Google Fonts family ID (null = system font, skip loading) */
	googleId: string | null
	fallback: string
}

export const SANS_FONTS: FontEntry[] = [
	{
		id: "system",
		name: "System Default",
		googleId: null,
		fallback: "system-ui, -apple-system, sans-serif",
	},
	{ id: "inter", name: "Inter", googleId: "Inter", fallback: "system-ui, sans-serif" },
	{ id: "dm-sans", name: "DM Sans", googleId: "DM+Sans", fallback: "system-ui, sans-serif" },
	{ id: "geist-sans", name: "Geist", googleId: "Geist", fallback: "system-ui, sans-serif" },
	{
		id: "plus-jakarta",
		name: "Plus Jakarta Sans",
		googleId: "Plus+Jakarta+Sans",
		fallback: "system-ui, sans-serif",
	},
	{
		id: "nunito-sans",
		name: "Nunito Sans",
		googleId: "Nunito+Sans",
		fallback: "system-ui, sans-serif",
	},
	{ id: "open-sans", name: "Open Sans", googleId: "Open+Sans", fallback: "system-ui, sans-serif" },
	{ id: "roboto", name: "Roboto", googleId: "Roboto", fallback: "system-ui, sans-serif" },
	{ id: "lato", name: "Lato", googleId: "Lato", fallback: "system-ui, sans-serif" },
	{ id: "poppins", name: "Poppins", googleId: "Poppins", fallback: "system-ui, sans-serif" },
]

export const MONO_FONTS: FontEntry[] = [
	{
		id: "system-mono",
		name: "System Default",
		googleId: null,
		fallback: 'ui-monospace, "SF Mono", Menlo, monospace',
	},
	{
		id: "jetbrains-mono",
		name: "JetBrains Mono",
		googleId: "JetBrains+Mono",
		fallback: "ui-monospace, monospace",
	},
	{
		id: "fira-code",
		name: "Fira Code",
		googleId: "Fira+Code",
		fallback: "ui-monospace, monospace",
	},
	{
		id: "source-code-pro",
		name: "Source Code Pro",
		googleId: "Source+Code+Pro",
		fallback: "ui-monospace, monospace",
	},
	{
		id: "ibm-plex-mono",
		name: "IBM Plex Mono",
		googleId: "IBM+Plex+Mono",
		fallback: "ui-monospace, monospace",
	},
	{
		id: "geist-mono",
		name: "Geist Mono",
		googleId: "Geist+Mono",
		fallback: "ui-monospace, monospace",
	},
	{
		id: "inconsolata",
		name: "Inconsolata",
		googleId: "Inconsolata",
		fallback: "ui-monospace, monospace",
	},
	{
		id: "roboto-mono",
		name: "Roboto Mono",
		googleId: "Roboto+Mono",
		fallback: "ui-monospace, monospace",
	},
]

const loadedFonts = new Set<string>()

/**
 * Load a font from Google Fonts by appending a <link> tag.
 * Non-blocking — uses `display=swap` so text renders with fallback immediately.
 * Silently skips if already loaded or if googleId is null.
 */
export function loadFont(googleId: string | null): void {
	if (!googleId || loadedFonts.has(googleId)) return
	loadedFonts.add(googleId)

	const link = document.createElement("link")
	link.rel = "stylesheet"
	link.href = `https://fonts.googleapis.com/css2?family=${googleId}:wght@300;400;500;600;700&display=swap`
	document.head.appendChild(link)
}

/**
 * Returns a full font-family CSS value for the given font ID.
 * Loads the font if not yet loaded.
 */
export function getFontStack(fontId: string | null, category: "sans" | "mono"): string {
	if (!fontId) {
		return category === "sans"
			? "system-ui, -apple-system, sans-serif"
			: 'ui-monospace, "SF Mono", Menlo, monospace'
	}

	const catalog = category === "sans" ? SANS_FONTS : MONO_FONTS
	const entry = catalog.find((f) => f.id === fontId)
	if (!entry) return getFontStack(null, category)

	// Trigger lazy load
	loadFont(entry.googleId)

	if (!entry.googleId) return entry.fallback
	const familyName = entry.googleId.replace(/\+/g, " ")
	return `"${familyName}", ${entry.fallback}`
}

/** Find a font entry by ID from either catalog. */
export function findFont(fontId: string | null, category: "sans" | "mono"): FontEntry | undefined {
	if (!fontId) return undefined
	const catalog = category === "sans" ? SANS_FONTS : MONO_FONTS
	return catalog.find((f) => f.id === fontId)
}
