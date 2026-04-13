import DOMPurify from "dompurify"
import { Marked } from "marked"
import { highlightCode } from "./highlighter"

// ── Marked instance ──────────────────────────────────────────────

const marked = new Marked({
	gfm: true,
	breaks: false,
	renderer: {
		link({ href, title, text }) {
			const titleAttr = title ? ` title="${title}"` : ""
			return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
		},
	},
})

// ── DOMPurify configuration ──────────────────────────────────────

if (typeof window !== "undefined" && DOMPurify.isSupported) {
	// Ensure all target="_blank" links have noopener/noreferrer
	DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
		if (!(node instanceof HTMLAnchorElement)) return
		if (node.target !== "_blank") return
		const rel = node.getAttribute("rel") ?? ""
		const set = new Set(rel.split(/\s+/).filter(Boolean))
		set.add("noopener")
		set.add("noreferrer")
		node.setAttribute("rel", Array.from(set).join(" "))
	})
}

/**
 * URI allowlist for sanitized markdown output. DOMPurify's default would
 * accept `data:` URIs on non-image tags and certain `srcset` combinations;
 * we explicitly restrict hrefs/srcs to:
 *   - http/https   (external links / remote images)
 *   - mailto/tel   (click-to-contact)
 *   - data:image/* (inline images only — no scriptable SVG data:)
 *   - relative     (in-document anchors / app routes)
 *
 * `javascript:`, `vbscript:`, bare `data:text/html`, and similar are all
 * blocked by virtue of not matching the pattern.
 */
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel):|data:image\/(?:png|jpeg|gif|webp);|[#/?])/i

const PURIFY_CONFIG = {
	USE_PROFILES: { html: true },
	SANITIZE_NAMED_PROPS: true,
	FORBID_TAGS: ["style"] as string[],
	FORBID_CONTENTS: ["style", "script"] as string[],
	ALLOWED_URI_REGEXP,
}

function sanitize(html: string): string {
	if (!DOMPurify.isSupported) return ""
	return DOMPurify.sanitize(html, PURIFY_CONFIG)
}

// ── Code block highlighting ──────────────────────────────────────

const CODE_BLOCK_RE = /<pre><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g

/**
 * Post-process parsed HTML to replace fenced code blocks with
 * Shiki-highlighted output. Embeds `data-language` on the `<pre>` so
 * decorateCodeBlocks can show the language label after the swap.
 */
async function highlightCodeBlocks(html: string): Promise<string> {
	const matches = [...html.matchAll(CODE_BLOCK_RE)]
	if (matches.length === 0) return html

	let result = html
	for (const match of matches) {
		const [fullMatch, lang, escapedCode] = match
		const language = lang || "text"

		// Unescape HTML entities that marked produced
		const code = escapedCode
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&amp;/g, "&")
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'")

		let highlighted = await highlightCode(code, language)

		// Embed language attribute so decoration survives the sync→async transition
		if (language !== "text") {
			highlighted = highlighted.replace("<pre ", `<pre data-language="${language}" `)
		}

		result = result.replace(fullMatch, () => highlighted)
	}

	return result
}

// ── LRU cache ────────────────────────────────────────────────────

interface CacheEntry {
	hash: string
	html: string
}

const MAX_CACHE = 200
const cache = new Map<string, CacheEntry>()

/** Touch an entry (move to end) and evict the oldest if over capacity. */
function touch(key: string, entry: CacheEntry) {
	cache.delete(key)
	cache.set(key, entry)
	if (cache.size > MAX_CACHE) {
		const first = cache.keys().next().value
		if (first) cache.delete(first)
	}
}

/**
 * Simple FNV-1a hash for cache key derivation.
 * Not cryptographic — just fast enough to detect content changes.
 */
export function contentHash(str: string): string {
	let hash = 0x811c9dc5
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i)
		hash = (hash * 0x01000193) >>> 0
	}
	return hash.toString(36)
}

// ── Fallback (plain text escape) ─────────────────────────────────

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;")
}

function fallback(markdown: string): string {
	return escapeHtml(markdown).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>")
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Return fully-highlighted HTML from cache if it matches the current content.
 * Returns null on cache miss — caller should fall back to sync parse.
 */
export function getCachedHtml(markdown: string, cacheKey?: string): string | null {
	const hash = contentHash(markdown)
	const key = cacheKey ?? hash
	const cached = cache.get(key)
	if (cached && cached.hash === hash) {
		touch(key, cached)
		return cached.html
	}
	return null
}

/**
 * Synchronous markdown parse — no syntax highlighting.
 *
 * Used for instant initial render so the container is never empty.
 * Content appears immediately with basic formatting; code blocks
 * show as plain monospace text until the async phase completes.
 */
export function parseMarkdownSync(markdown: string): string {
	try {
		// marked.parse is synchronous when no async extensions are configured
		return sanitize(marked.parse(markdown) as string)
	} catch {
		return fallback(markdown)
	}
}

/**
 * Full async parse with Shiki syntax highlighting + LRU caching.
 *
 * During streaming the caller should pass the part ID as `cacheKey`
 * so cache entries are overwritten in-place rather than creating a
 * new slot per delta.
 */
export async function parseMarkdownAsync(markdown: string, cacheKey?: string): Promise<string> {
	const hash = contentHash(markdown)
	const key = cacheKey ?? hash

	// Double-check cache (may have been populated between sync render and this call)
	const cached = cache.get(key)
	if (cached && cached.hash === hash) {
		touch(key, cached)
		return cached.html
	}

	let html: string
	try {
		html = marked.parse(markdown) as string
		html = sanitize(html)
		html = await highlightCodeBlocks(html)
	} catch {
		html = fallback(markdown)
	}

	touch(key, { hash, html })
	return html
}
