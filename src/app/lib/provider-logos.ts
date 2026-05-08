import DOMPurify from "dompurify"
import cursorPng from "../assets/icons/editors/cursor.png"
// Inline raw SVG so it's rendered with currentColor and adapts to the
// chat theme. Vite returns `?raw` imports as a literal string at build
// time — no runtime fetch involved.
import claudeSvg from "../assets/icons/providers/claude.svg?raw"
import opencodeSvg from "../assets/icons/providers/opencode-logo-dark.svg?raw"

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

const STORAGE_KEY = "loop:providerLogos"

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

// Hydrate from localStorage on module load (survives restarts)
try {
	const stored = localStorage.getItem(STORAGE_KEY)
	if (stored) {
		const entries = JSON.parse(stored) as Record<string, string>
		for (const [id, value] of Object.entries(entries)) {
			cache.set(id, value)
		}
	}
} catch {
	// Storage unavailable or corrupted — start fresh
}

// Cursor uses a local Vite asset URL — seed the cache (overrides any stale stored URL)
cache.set("cursor", cursorPng)

// Claude Code provider — bundle the official asterisk mark locally and
// seed the cache as raw SVG so it renders inline (currentColor support).
// Without this we fall through to models.dev which serves a generic
// sparkle, indistinguishable from a tag-cloud icon.
cache.set("claude-code", claudeSvg)

// OpenCode provider — same pattern. The synthetic `opencode` provider
// isn't on models.dev, so we ship the official mark locally. We store
// it RAW (no `adaptSvgColors`) because the bicolor brand mark is
// intentional: dark frame + light interior + small dark notch. Forcing
// the dark fill to `currentColor` would invert it to white on dark
// themes and lose the intended look. Trusted bundled asset, no sanitize.
cache.set("opencode", opencodeSvg)

/** Persist the current cache to localStorage (excludes "error" entries and local assets). */
function persistCache(): void {
	try {
		const obj: Record<string, string> = {}
		for (const [id, value] of cache) {
			// Only persist fetched SVGs — skip errors and local asset URLs
			if (value !== "error" && value.trimStart().startsWith("<")) {
				obj[id] = value
			}
		}
		localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
	} catch {
		// Storage full or unavailable — silently ignore
	}
}

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

/**
 * DOMPurify configuration for sanitizing third-party provider SVGs.
 * We parse as SVG (not HTML) and strip any `foreignObject` — the latter can
 * host arbitrary HTML including scripts. Regex-based sanitization cannot
 * reliably defeat namespaced attributes, CDATA, or mixed casing, which is
 * why we use DOMPurify here even though the input is "just an icon".
 */
const SVG_PURIFY_CONFIG = {
	USE_PROFILES: { svg: true, svgFilters: true },
	FORBID_TAGS: ["script", "foreignObject", "a", "use"] as string[],
	FORBID_ATTR: ["onload", "onerror", "onclick", "href", "xlink:href"] as string[],
}

/** Strip script elements, event handlers, and external refs from SVG text. */
function sanitizeSvg(svg: string): string {
	if (typeof window === "undefined" || !DOMPurify.isSupported) return ""
	return DOMPurify.sanitize(svg, SVG_PURIFY_CONFIG)
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
			persistCache()
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
