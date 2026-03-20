import morphdom from "morphdom"
import { useEffect, useRef } from "react"
import { openFile } from "../../lib/editor"
import { getCachedHtml, parseMarkdownAsync, parseMarkdownSync } from "../../lib/markdown"
import { parseFilePath } from "./file-reference"
import "./markdown.css"

// ── Copy button helpers ──────────────────────────────────────────

const COPY_ICON =
	'<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6.25 6.25V2.92h10.83v10.83h-3.33M13.75 6.25v10.83H2.92V6.25h10.83Z" stroke="currentColor" stroke-linecap="round"/></svg>'
const CHECK_ICON =
	'<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5 12 8.38 14.75 15 5.83" stroke="currentColor" stroke-linecap="square"/></svg>'

function createCopyButton(): HTMLButtonElement {
	const btn = document.createElement("button")
	btn.type = "button"
	btn.className = "md-copy-btn"
	btn.setAttribute("aria-label", "Copy code")
	btn.setAttribute("data-tooltip", "Copy")
	btn.innerHTML = `<span class="md-copy-icon">${COPY_ICON}</span><span class="md-check-icon">${CHECK_ICON}</span>`
	return btn
}

// ── Code block decoration ────────────────────────────────────────

function decorateCodeBlocks(root: HTMLDivElement) {
	for (const pre of root.querySelectorAll("pre")) {
		if (pre.parentElement?.classList.contains("md-code-wrapper")) continue
		const wrapper = document.createElement("div")
		wrapper.className = "md-code-wrapper"

		// Extract language from <code class="language-*"> (sync phase)
		// or from data-language attribute (async/shiki phase)
		const code = pre.querySelector("code")
		let lang =
			code?.className?.match(/language-(\S+)/)?.[1] ?? pre.getAttribute("data-language") ?? null
		if (lang === "text" || lang === "plaintext" || lang === "txt") lang = null

		// Header bar: language label (left) + copy button (right)
		const header = document.createElement("div")
		header.className = "md-code-header"

		const label = document.createElement("span")
		label.className = "md-lang-label"
		if (lang) label.textContent = lang
		header.appendChild(label)
		header.appendChild(createCopyButton())

		pre.parentNode?.replaceChild(wrapper, pre)
		wrapper.appendChild(header)
		wrapper.appendChild(pre)
	}
}

// ── File reference detection ─────────────────────────────────────

function markFileReferences(root: HTMLDivElement) {
	for (const code of root.querySelectorAll<HTMLElement>(":not(pre) > code")) {
		const text = code.textContent ?? ""
		const parsed = parseFilePath(text)
		if (!parsed) continue
		code.setAttribute("data-file-path", parsed.path)
		if (parsed.line) code.setAttribute("data-file-line", String(parsed.line))
		code.classList.add("md-file-ref")
	}
}

// ── Event delegation ─────────────────────────────────────────────

function setupDelegation(root: HTMLDivElement): () => void {
	const timeouts = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>()

	const handler = async (e: MouseEvent) => {
		const target = e.target
		if (!(target instanceof Element)) return

		// Copy button click
		const copyBtn = target.closest<HTMLButtonElement>(".md-copy-btn")
		if (copyBtn) {
			const code = copyBtn.closest(".md-code-wrapper")?.querySelector("code")
			const content = code?.textContent ?? ""
			if (!content) return
			await navigator.clipboard.writeText(content)
			copyBtn.setAttribute("data-copied", "true")
			copyBtn.setAttribute("data-tooltip", "Copied!")
			const prev = timeouts.get(copyBtn)
			if (prev) clearTimeout(prev)
			timeouts.set(
				copyBtn,
				setTimeout(() => {
					copyBtn.removeAttribute("data-copied")
					copyBtn.setAttribute("data-tooltip", "Copy")
				}, 2000),
			)
			return
		}

		// File reference click
		const fileRef = target.closest<HTMLElement>(".md-file-ref")
		if (fileRef) {
			e.preventDefault()
			const path = fileRef.getAttribute("data-file-path")
			const line = fileRef.getAttribute("data-file-line")
			if (path) openFile(path, line ? Number(line) : undefined)
		}
	}

	root.addEventListener("click", handler)
	return () => {
		root.removeEventListener("click", handler)
		for (const t of timeouts.values()) clearTimeout(t)
	}
}

// ── DOM patching helper ──────────────────────────────────────────

/**
 * Decorate and patch HTML into a container via morphdom.
 * Re-binds event delegation after each patch since morphdom may
 * replace the nodes that had listeners attached.
 */
function patchContainer(
	container: HTMLDivElement,
	html: string,
	cleanupRef: React.RefObject<(() => void) | null>,
) {
	const temp = document.createElement("div")
	temp.innerHTML = html
	decorateCodeBlocks(temp)
	markFileReferences(temp)

	morphdom(container, temp, {
		childrenOnly: true,
		onBeforeElUpdated(fromEl, toEl) {
			return !fromEl.isEqualNode(toEl)
		},
	})

	if (cleanupRef.current) cleanupRef.current()
	cleanupRef.current = setupDelegation(container)
}

// ── Component ────────────────────────────────────────────────────

export interface MarkdownProps {
	/** Markdown source text. */
	text: string
	/** Stable cache key (e.g. part ID). Avoids cache churn during streaming. */
	cacheKey?: string
	className?: string
}

/**
 * High-performance markdown renderer with two-phase rendering.
 *
 * Phase 1 (sync):  marked parse → DOMPurify → morphdom.
 *                  Content appears instantly — no empty-div flash.
 * Phase 2 (async): Shiki highlights code blocks → morphdom patches
 *                  only the changed `<pre>` elements.
 *
 * On cache hit (scrolling back to a previously rendered message),
 * the fully-highlighted HTML is applied in a single synchronous step.
 */
export function Markdown({ text, cacheKey, className }: MarkdownProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const cleanupRef = useRef<(() => void) | null>(null)

	useEffect(() => {
		const container = containerRef.current
		if (!container) return

		if (!text) {
			container.innerHTML = ""
			return
		}

		// ── Phase 1: Instant render ─────────────────────────────
		// Check cache first — fully highlighted HTML from a prior render.
		// On cache hit this is the only work done (common during scroll).
		const cached = getCachedHtml(text, cacheKey)
		if (cached) {
			patchContainer(container, cached, cleanupRef)
			return
		}

		// Cache miss — synchronous parse (no syntax highlighting).
		// The container gets real content immediately so it has the
		// correct height and avoids layout shift / flash.
		patchContainer(container, parseMarkdownSync(text), cleanupRef)

		// ── Phase 2: Async enhancement ──────────────────────────
		// Shiki highlights code blocks in the background.
		// morphdom then patches only the <pre> elements that changed.
		let cancelled = false
		parseMarkdownAsync(text, cacheKey).then((html) => {
			if (cancelled || !containerRef.current) return
			patchContainer(containerRef.current, html, cleanupRef)
		})

		return () => {
			cancelled = true
		}
	}, [text, cacheKey])

	// Cleanup delegation listeners on unmount
	useEffect(() => {
		return () => {
			if (cleanupRef.current) {
				cleanupRef.current()
				cleanupRef.current = null
			}
		}
	}, [])

	return <div ref={containerRef} data-component="markdown" className={className} />
}
