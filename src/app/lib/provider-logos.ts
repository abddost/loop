import cursorSvg from "../assets/icons/editors/cursor.svg"

/**
 * Shared provider logo cache and preload system.
 *
 * Fetched SVGs are stored as processed SVG text with dark fills replaced by
 * `currentColor` so they adapt to light/dark themes when rendered inline.
 * Local assets (cursor) are stored as URLs and rendered via <img>.
 *
 * The cache is warmed during bootstrap so ProviderIcon renders instantly.
 */

// ─── Cache ──────────────────────────────────────────────────────

/**
 * Cached logo values. "error" marks permanently failed fetches.
 * Values are either raw SVG text (starts with "<") or asset URLs.
 */
const cache = new Map<string, string | "error">()

/** In-flight fetch deduplication. */
const inFlight = new Map<string, Promise<string | "error">>()

/** Internal provider IDs that differ from models.dev IDs. */
const LOGO_ID_MAP: Record<string, string> = {
	google: "google-generative-ai",
}

// Cursor uses a local Vite asset URL — seed the cache immediately
cache.set("cursor", cursorSvg)

// ─── SVG Processing ─────────────────────────────────────────────

/** Whether a CSS color value is perceptually dark (luminance < 50/255). */
function isDark(color: string): boolean {
	const c = color.trim().toLowerCase()
	if (c === "black") return true
	if (c === "none" || c === "white" || c === "transparent") return false
	if (c.startsWith("url(")) return false

	if (!c.startsWith("#")) return false
	let r: number
	let g: number
	let b: number
	if (c.length === 4) {
		r = Number.parseInt(c[1] + c[1], 16)
		g = Number.parseInt(c[2] + c[2], 16)
		b = Number.parseInt(c[3] + c[3], 16)
	} else if (c.length === 7) {
		r = Number.parseInt(c.slice(1, 3), 16)
		g = Number.parseInt(c.slice(3, 5), 16)
		b = Number.parseInt(c.slice(5, 7), 16)
	} else {
		return false
	}
	return 0.299 * r + 0.587 * g + 0.114 * b < 50
}

/** Strip script elements and event handlers from SVG text. */
function sanitizeSvg(svg: string): string {
	return svg
		.replace(/<script[\s\S]*?<\/script>/gi, "")
		.replace(/\bon\w+\s*=\s*"[^"]*"/gi, "")
		.replace(/\bon\w+\s*=\s*'[^']*'/gi, "")
}

/**
 * Replace dark fills with `currentColor` so the SVG adapts to the theme.
 * Also removes fixed width/height to allow CSS sizing (if viewBox exists).
 */
function adaptSvgColors(svg: string): string {
	let result = svg.replace(/fill="([^"]*)"/g, (match, value) =>
		isDark(value) ? 'fill="currentColor"' : match,
	)

	// Ensure root <svg> has fill="currentColor" for child elements with no explicit fill
	if (!/<svg[^>]*\bfill=/.test(result)) {
		result = result.replace(/<svg/, '<svg fill="currentColor"')
	}

	// Remove fixed dimensions so the SVG scales via CSS (only if viewBox exists)
	if (/viewBox/.test(result)) {
		result = result.replace(/(<svg[^>]*?)\s+width="[^"]*"/g, "$1")
		result = result.replace(/(<svg[^>]*?)\s+height="[^"]*"/g, "$1")
	}

	return result
}

/** Full SVG processing pipeline. */
function processSvg(raw: string): string {
	return adaptSvgColors(sanitizeSvg(raw))
}

// ─── Public API ─────────────────────────────────────────────────

/**
 * Get the cached logo for a provider, or null if not yet loaded / failed.
 * Returns raw SVG text (starts with "<") or a URL string.
 */
export function getProviderLogo(providerId: string): string | null {
	const v = cache.get(providerId)
	return v && v !== "error" ? v : null
}

/**
 * Fetch a single provider logo (deduplicated + cached).
 * Returns processed SVG text on success, "error" on failure.
 */
export function fetchProviderLogo(providerId: string): Promise<string | "error"> {
	if (cache.has(providerId)) return Promise.resolve(cache.get(providerId)!)

	const existing = inFlight.get(providerId)
	if (existing) return existing

	const modelsDevId = LOGO_ID_MAP[providerId] ?? providerId
	const url = `https://models.dev/logos/${modelsDevId}.svg`

	const p = fetch(url)
		.then(async (res) => {
			if (!res.ok) throw new Error(`${res.status}`)
			const raw = await res.text()
			const processed = processSvg(raw)
			cache.set(providerId, processed)
			return processed
		})
		.catch(() => {
			cache.set(providerId, "error")
			return "error" as const
		})
		.finally(() => {
			inFlight.delete(providerId)
		})

	inFlight.set(providerId, p)
	return p
}

/**
 * Preload logos for a list of provider IDs.
 * Fire-and-forget — does not block. Populates the cache for future reads.
 */
export function preloadProviderLogos(providerIds: string[]): void {
	for (const id of providerIds) {
		if (!cache.has(id)) fetchProviderLogo(id)
	}
}
