import morphdom from "morphdom"
import { useEffect, useLayoutEffect, useRef } from "react"
import { openFile } from "../../lib/editor"
import {
	contentHash,
	getCachedHtml,
	parseMarkdownAsync,
	parseMarkdownSync,
} from "../../lib/markdown"
import { parseFilePath } from "./file-reference"
import "./markdown.css"

// ── Copy button helpers ──────────────────────────────────────────

const COPY_ICON =
	'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.7587 2H16.2413C17.0463 1.99999 17.7106 1.99998 18.2518 2.04419C18.8139 2.09012 19.3306 2.18868 19.816 2.43597C20.5686 2.81947 21.1805 3.43139 21.564 4.18404C21.8113 4.66937 21.9099 5.18608 21.9558 5.74817C22 6.28936 22 6.95372 22 7.75868V11.2413C22 12.0463 22 12.7106 21.9558 13.2518C21.9099 13.8139 21.8113 14.3306 21.564 14.816C21.1805 15.5686 20.5686 16.1805 19.816 16.564C19.3306 16.8113 18.8139 16.9099 18.2518 16.9558C17.8906 16.9853 17.4745 16.9951 16.9984 16.9984C16.9951 17.4745 16.9853 17.8906 16.9558 18.2518C16.9099 18.8139 16.8113 19.3306 16.564 19.816C16.1805 20.5686 15.5686 21.1805 14.816 21.564C14.3306 21.8113 13.8139 21.9099 13.2518 21.9558C12.7106 22 12.0463 22 11.2413 22H7.75868C6.95372 22 6.28936 22 5.74818 21.9558C5.18608 21.9099 4.66937 21.8113 4.18404 21.564C3.43139 21.1805 2.81947 20.5686 2.43597 19.816C2.18868 19.3306 2.09012 18.8139 2.04419 18.2518C1.99998 17.7106 1.99999 17.0463 2 16.2413V12.7587C1.99999 11.9537 1.99998 11.2894 2.04419 10.7482C2.09012 10.1861 2.18868 9.66937 2.43597 9.18404C2.81947 8.43139 3.43139 7.81947 4.18404 7.43598C4.66937 7.18868 5.18608 7.09012 5.74817 7.04419C6.10939 7.01468 6.52548 7.00487 7.00162 7.00162C7.00487 6.52548 7.01468 6.10939 7.04419 5.74817C7.09012 5.18608 7.18868 4.66937 7.43598 4.18404C7.81947 3.43139 8.43139 2.81947 9.18404 2.43597C9.66937 2.18868 10.1861 2.09012 10.7482 2.04419C11.2894 1.99998 11.9537 1.99999 12.7587 2ZM9.00176 7L11.2413 7C12.0463 6.99999 12.7106 6.99998 13.2518 7.04419C13.8139 7.09012 14.3306 7.18868 14.816 7.43598C15.5686 7.81947 16.1805 8.43139 16.564 9.18404C16.8113 9.66937 16.9099 10.1861 16.9558 10.7482C17 11.2894 17 11.9537 17 12.7587V14.9982C17.4455 14.9951 17.7954 14.9864 18.089 14.9624C18.5274 14.9266 18.7516 14.8617 18.908 14.782C19.2843 14.5903 19.5903 14.2843 19.782 13.908C19.8617 13.7516 19.9266 13.5274 19.9624 13.089C19.9992 12.6389 20 12.0566 20 11.2V7.8C20 6.94342 19.9992 6.36113 19.9624 5.91104C19.9266 5.47262 19.8617 5.24842 19.782 5.09202C19.5903 4.7157 19.2843 4.40973 18.908 4.21799C18.7516 4.1383 18.5274 4.07337 18.089 4.03755C17.6389 4.00078 17.0566 4 16.2 4H12.8C11.9434 4 11.3611 4.00078 10.911 4.03755C10.4726 4.07337 10.2484 4.1383 10.092 4.21799C9.7157 4.40973 9.40973 4.7157 9.21799 5.09202C9.1383 5.24842 9.07337 5.47262 9.03755 5.91104C9.01357 6.20463 9.00489 6.55447 9.00176 7ZM5.91104 9.03755C5.47262 9.07337 5.24842 9.1383 5.09202 9.21799C4.7157 9.40973 4.40973 9.7157 4.21799 10.092C4.1383 10.2484 4.07337 10.4726 4.03755 10.911C4.00078 11.3611 4 11.9434 4 12.8V16.2C4 17.0566 4.00078 17.6389 4.03755 18.089C4.07337 18.5274 4.1383 18.7516 4.21799 18.908C4.40973 19.2843 4.7157 19.5903 5.09202 19.782C5.24842 19.8617 5.47262 19.9266 5.91104 19.9624C6.36113 19.9992 6.94342 20 7.8 20H11.2C12.0566 20 12.6389 19.9992 13.089 19.9624C13.5274 19.9266 13.7516 19.8617 13.908 19.782C14.2843 19.5903 14.5903 19.2843 14.782 18.908C14.8617 18.7516 14.9266 18.5274 14.9624 18.089C14.9992 17.6389 15 17.0566 15 16.2V12.8C15 11.9434 14.9992 11.3611 14.9624 10.911C14.9266 10.4726 14.8617 10.2484 14.782 10.092C14.5903 9.7157 14.2843 9.40973 13.908 9.21799C13.7516 9.1383 13.5274 9.07337 13.089 9.03755C12.6389 9.00078 12.0566 9 11.2 9H7.8C6.94342 9 6.36113 9.00078 5.91104 9.03755Z" fill="currentColor"/></svg>'
const CHECK_ICON =
	'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M18.063 5.674a1 1 0 0 1 .263 1.39l-7.5 11a1 1 0 0 1-1.533.143l-4.5-4.5a1 1 0 1 1 1.414-1.414l3.647 3.647 6.82-10.003a1 1 0 0 1 1.39-.263Z" clip-rule="evenodd"/></svg>'

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

// ── Sync render helper ────────────────────────────────────────────

/** Parse markdown synchronously (cache-aware) and patch into container. */
function renderSync(
	container: HTMLDivElement,
	text: string,
	cacheKey: string | undefined,
	cleanupRef: React.RefObject<(() => void) | null>,
) {
	const cached = getCachedHtml(text, cacheKey)
	patchContainer(container, cached ?? parseMarkdownSync(text), cleanupRef)
}

// ── Component ────────────────────────────────────────────────────

/** Throttle interval for markdown re-parsing during streaming (ms). */
const STREAM_RENDER_THROTTLE = 100

export interface MarkdownProps {
	/** Markdown source text. */
	text: string
	/** Stable cache key (e.g. part ID). Avoids cache churn during streaming. */
	cacheKey?: string
	className?: string
	/** When true, throttle re-parsing to ~10fps and skip async Shiki. */
	streaming?: boolean
}

/**
 * High-performance markdown renderer with two-phase rendering.
 *
 * Phase 1 (sync):  marked parse → DOMPurify → morphdom.
 *                  Content appears instantly — no empty-div flash.
 * Phase 2 (async): Shiki highlights code blocks → morphdom patches
 *                  only the changed `<pre>` elements.
 *
 * During streaming, re-parsing is throttled to 100ms intervals. The first
 * render is always instant; Shiki runs once when
 * streaming ends. This drops markdown work from ~100/s to ~10/s.
 *
 * On cache hit (scrolling back to a previously rendered message),
 * the fully-highlighted HTML is applied in a single synchronous step.
 */
export function Markdown({ text, cacheKey, className, streaming }: MarkdownProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const cleanupRef = useRef<(() => void) | null>(null)

	// Throttle state (refs to avoid re-render overhead)
	const lastRenderRef = useRef(0)
	const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const latestTextRef = useRef(text)
	latestTextRef.current = text

	// Track rendered content to skip redundant re-parses
	// (e.g. streaming→static transition where text hasn't changed)
	const lastRenderedHashRef = useRef<string | null>(null)

	// ── Streaming render (throttled) ─────────────────────────
	useEffect(() => {
		if (!streaming) return
		const container = containerRef.current
		if (!container) return

		if (!text) {
			container.innerHTML = ""
			lastRenderedHashRef.current = null
			return
		}

		const hash = contentHash(text)
		if (hash === lastRenderedHashRef.current) return

		const now = performance.now()
		const elapsed = now - lastRenderRef.current

		// Inside throttle window — schedule trailing render
		if (elapsed < STREAM_RENDER_THROTTLE && lastRenderRef.current > 0) {
			if (!throttleRef.current) {
				throttleRef.current = setTimeout(() => {
					throttleRef.current = null
					if (!containerRef.current) return
					renderSync(containerRef.current, latestTextRef.current, cacheKey, cleanupRef)
					lastRenderedHashRef.current = contentHash(latestTextRef.current)
					lastRenderRef.current = performance.now()
				}, STREAM_RENDER_THROTTLE - elapsed)
			}
			return
		}

		// Immediate render (first delta or throttle window expired)
		lastRenderRef.current = now
		renderSync(container, text, cacheKey, cleanupRef)
		lastRenderedHashRef.current = hash
	}, [streaming, text, cacheKey])

	// ── Static render (full two-phase) ───────────────────────
	// useLayoutEffect prevents the empty-div flash on mount/scroll.
	// Content renders before the browser paints — no visible empty frame.
	useLayoutEffect(() => {
		if (streaming) return
		const container = containerRef.current
		if (!container) return

		if (!text) {
			container.innerHTML = ""
			lastRenderedHashRef.current = null
			return
		}

		// Phase 1: sync render — skip if already rendered (streaming→static transition)
		const hash = contentHash(text)
		if (hash !== lastRenderedHashRef.current) {
			renderSync(container, text, cacheKey, cleanupRef)
			lastRenderedHashRef.current = hash
		}

		// Phase 2: async Shiki enhancement
		let cancelled = false
		parseMarkdownAsync(text, cacheKey).then((html) => {
			if (cancelled || !containerRef.current) return
			patchContainer(containerRef.current, html, cleanupRef)
		})

		return () => {
			cancelled = true
		}
	}, [streaming, text, cacheKey])

	// Cleanup throttle timer and delegation on unmount
	useEffect(() => {
		return () => {
			if (throttleRef.current) clearTimeout(throttleRef.current)
			if (cleanupRef.current) {
				cleanupRef.current()
				cleanupRef.current = null
			}
		}
	}, [])

	return <div ref={containerRef} data-component="markdown" className={className} />
}
