import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from "@codemirror/language"
import {
	findNext,
	findPrevious,
	highlightSelectionMatches,
	search,
	selectNextOccurrence,
} from "@codemirror/search"
import {
	Compartment,
	EditorState,
	RangeSetBuilder,
	StateEffect,
	StateField,
} from "@codemirror/state"
import {
	Decoration,
	type DecorationSet,
	EditorView,
	type ViewUpdate,
	crosshairCursor,
	drawSelection,
	highlightActiveLine,
	highlightActiveLineGutter,
	highlightSpecialChars,
	keymap,
	lineNumbers,
	rectangularSelection,
} from "@codemirror/view"
import { Chat } from "@openai/apps-sdk-ui/components/Icon"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { attachmentBridge } from "../../lib/attachment-bridge"
import { highlightDiffLines } from "../../lib/markdown/highlighter"
import { SearchOverlay } from "./search-overlay"

// ── Shiki → CodeMirror highlighting bridge ──────────────────────────
//
// We reuse the app-wide `getHighlighter()` Shiki instance (via
// `highlightDiffLines`) so syntax colors stay 1:1 with markdown code
// blocks elsewhere in the UI. Tokens are converted to CodeMirror
// decorations once per content/language change.

const setShikiHighlights = StateEffect.define<DecorationSet>()

const shikiHighlightField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, tr) {
		let next = deco.map(tr.changes)
		for (const e of tr.effects) {
			if (e.is(setShikiHighlights)) next = e.value
		}
		return next
	},
	provide: (f) => EditorView.decorations.from(f),
})

const DEFAULT_TOKEN_COLOR = "var(--syntax-foreground)"

async function applyShikiHighlights(view: EditorView, content: string, lang: string) {
	const lines = content.split("\n")
	const tokens = await highlightDiffLines(lines, lang)
	if (view.dom.isConnected === false) return

	const builder = new RangeSetBuilder<Decoration>()
	let pos = 0
	for (let i = 0; i < tokens.length; i++) {
		for (const t of tokens[i]) {
			const end = pos + t.content.length
			if (t.color !== DEFAULT_TOKEN_COLOR && t.content.length > 0) {
				builder.add(pos, end, Decoration.mark({ attributes: { style: `color:${t.color}` } }))
			}
			pos = end
		}
		if (i < tokens.length - 1) pos += 1 // newline
	}

	view.dispatch({ effects: setShikiHighlights.of(builder.finish()) })
}

// ── Theme ───────────────────────────────────────────────────────────
//
// All colors come from app CSS variables so light/dark switches
// without re-instantiating the editor.

const loopTheme = EditorView.theme({
	"&": {
		height: "100%",
		backgroundColor: "transparent",
		color: "var(--syntax-foreground)",
		fontSize: "13px",
	},
	".cm-scroller": {
		fontFamily: "var(--font-mono)",
		lineHeight: "1.55",
		overflow: "auto",
	},
	".cm-content": {
		padding: "8px 0",
	},
	".cm-gutters": {
		backgroundColor: "transparent",
		color: "var(--muted)",
		border: "none",
		paddingRight: "4px",
	},
	".cm-lineNumbers .cm-gutterElement": {
		minWidth: "32px",
		padding: "0 8px 0 12px",
	},
	".cm-foldGutter .cm-gutterElement": {
		opacity: "0.55",
	},
	".cm-activeLineGutter": {
		backgroundColor: "transparent",
		color: "var(--foreground)",
	},
	".cm-activeLine": {
		backgroundColor: "color-mix(in srgb, var(--foreground) 4%, transparent)",
	},
	".cm-line": {
		padding: "0 4px 0 8px",
	},
	".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
		backgroundColor: "color-mix(in srgb, var(--accent) 32%, transparent) !important",
	},
	".cm-cursor, .cm-dropCursor": {
		borderLeftColor: "var(--foreground)",
	},
	"&.cm-editor.cm-focused": {
		outline: "none",
	},
	".cm-searchMatch": {
		backgroundColor: "rgba(255, 140, 26, 0.28)",
		borderRadius: "2px",
		outline: "1px solid rgba(255, 140, 26, 0.55)",
	},
	".cm-searchMatch.cm-searchMatch-selected": {
		backgroundColor: "rgba(255, 140, 26, 0.65)",
		outline: "1px solid rgba(255, 168, 60, 0.95)",
		color: "#1a1300",
	},
	".cm-selectionMatch": {
		backgroundColor: "color-mix(in srgb, var(--foreground) 12%, transparent)",
	},
	".cm-panels": {
		backgroundColor: "var(--surface)",
		color: "var(--foreground)",
		borderTop: "1px solid var(--border)",
	},
	".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label": {
		fontFamily: "var(--font-ui)",
		fontSize: "12px",
	},
	".cm-panel.cm-search input": {
		backgroundColor: "var(--field-background)",
		color: "var(--field-foreground)",
		border: "1px solid var(--field-border)",
		borderRadius: "4px",
		padding: "2px 6px",
	},
	".cm-tooltip": {
		backgroundColor: "var(--surface)",
		color: "var(--foreground)",
		border: "1px solid var(--border)",
		borderRadius: "6px",
	},
})

// ── Centered search helpers ─────────────────────────────────────────
//
// CodeMirror's built-in findNext/findPrevious update the selection to the
// next match, which triggers an automatic `scrollIntoView` with the
// "nearest" margin. That lands matches at the very edge of the viewport
// and is hard to read. We re-dispatch with y: "center" so each jump
// pulls the match into the middle of the visible area.

export function findNextCentered(view: EditorView): boolean {
	const ok = findNext(view)
	if (ok) {
		view.dispatch({
			effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" }),
		})
	}
	return ok
}

export function findPreviousCentered(view: EditorView): boolean {
	const ok = findPrevious(view)
	if (ok) {
		view.dispatch({
			effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" }),
		})
	}
	return ok
}

// ── Cursor reporting ────────────────────────────────────────────────

export interface CursorInfo {
	line: number
	col: number
	selectionChars: number
}

function readCursor(view: EditorView): CursorInfo {
	const sel = view.state.selection.main
	const head = view.state.doc.lineAt(sel.head)
	let selectionChars = 0
	for (const range of view.state.selection.ranges) {
		selectionChars += Math.abs(range.to - range.from)
	}
	return {
		line: head.number,
		col: sel.head - head.from + 1,
		selectionChars,
	}
}

// ── Component ───────────────────────────────────────────────────────

interface CodeMirrorViewerProps {
	content: string
	language: string
	path: string
	readOnly?: boolean
	onCursorChange?: (info: CursorInfo) => void
	onContentChange?: (content: string) => void
	onSave?: () => void
}

export default function CodeMirrorViewer({
	content,
	language,
	path,
	readOnly = true,
	onCursorChange,
	onContentChange,
	onSave,
}: CodeMirrorViewerProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const viewRef = useRef<EditorView | null>(null)
	const prevPathRef = useRef<string>(path)
	const readOnlyCompartment = useRef(new Compartment())
	const cursorCbRef = useRef(onCursorChange)
	const contentCbRef = useRef(onContentChange)
	const saveCbRef = useRef(onSave)
	const applyingExternalRef = useRef(false)
	cursorCbRef.current = onCursorChange
	contentCbRef.current = onContentChange
	saveCbRef.current = onSave

	const [searchOpen, setSearchOpen] = useState(false)
	const searchOpenRef = useRef(false)
	searchOpenRef.current = searchOpen

	const [selectionRange, setSelectionRange] = useState<{
		startLine: number
		endLine: number
	} | null>(null)

	// Pixel-space anchor for the floating "Add to Chat" button. Tracks the
	// top of the first selected line so the button sits at line-level on
	// the right edge, even as the user scrolls.
	const [buttonTop, setButtonTop] = useState<number | null>(null)

	// Suppress the button while the user is mid-drag (mouse held down) so
	// it doesn't flash for every intermediate selection state. Mouseup
	// (anywhere on document — drag may end outside the editor) re-evaluates.
	const [isDragging, setIsDragging] = useState(false)

	// Two-phase post-add state machine:
	// - `justAdded`: flips to true on click; renders "Successfully added" for ~1.2s
	// - `consumed`:  set true after the success message clears; hides the button
	//                completely until the next selection change
	const [justAdded, setJustAdded] = useState(false)
	const [consumed, setConsumed] = useState(false)
	const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

	// Mount once. Initial doc/highlight come from current props; subsequent
	// updates are routed through the sync effect below.
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
	useEffect(() => {
		const container = containerRef.current
		if (!container) return

		const updateListener = EditorView.updateListener.of((u: ViewUpdate) => {
			if (u.selectionSet || u.docChanged) {
				cursorCbRef.current?.(readCursor(u.view))
				const sel = u.state.selection.main
				if (sel.from === sel.to) {
					setSelectionRange(null)
				} else {
					const startLine = u.state.doc.lineAt(sel.from).number
					const endLineRaw = u.state.doc.lineAt(sel.to).number
					// If selection ends exactly at the start of a line (line break
					// at the boundary), the trailing line is visually unselected
					// — exclude it from the displayed range.
					const endLine =
						sel.to === u.state.doc.line(endLineRaw).from && endLineRaw > startLine
							? endLineRaw - 1
							: endLineRaw
					setSelectionRange({ startLine, endLine })
				}
			}
			// Fire content callback only for user-driven changes, not for our
			// own external prop-sync dispatches (which we mark via the ref flag).
			if (u.docChanged && !applyingExternalRef.current) {
				contentCbRef.current?.(u.state.doc.toString())
			}
		})

		const customKeymap = keymap.of([
			{
				key: "Mod-f",
				run: () => {
					setSearchOpen(true)
					return true
				},
			},
			{ key: "Mod-g", run: findNextCentered, preventDefault: true },
			{ key: "Mod-Shift-g", run: findPreviousCentered, preventDefault: true },
			{ key: "Mod-d", run: selectNextOccurrence, preventDefault: true },
			{
				key: "Mod-s",
				run: () => {
					saveCbRef.current?.()
					return true
				},
				preventDefault: true,
			},
			{
				key: "Escape",
				run: () => {
					if (searchOpenRef.current) {
						setSearchOpen(false)
						return true
					}
					return false
				},
			},
			...defaultKeymap,
			...historyKeymap,
			...foldKeymap,
		])

		const view = new EditorView({
			state: EditorState.create({
				doc: content.replace(/\r\n/g, "\n"),
				extensions: [
					lineNumbers(),
					foldGutter(),
					highlightSpecialChars(),
					history(),
					drawSelection(),
					EditorState.allowMultipleSelections.of(true),
					rectangularSelection(),
					crosshairCursor(),
					indentOnInput(),
					bracketMatching(),
					highlightActiveLine(),
					highlightActiveLineGutter(),
					highlightSelectionMatches(),
					search({ top: true }),
					readOnlyCompartment.current.of(EditorState.readOnly.of(readOnly)),
					shikiHighlightField,
					loopTheme,
					updateListener,
					customKeymap,
				],
			}),
			parent: container,
		})
		viewRef.current = view
		cursorCbRef.current?.(readCursor(view))

		return () => {
			view.destroy()
			viewRef.current = null
		}
	}, [])

	// Track the first-line top of the active selection in container-relative
	// pixels. Recomputed on selection change AND on every scroll so the
	// floating "Add to Chat" button stays anchored to the line as the user
	// pages through the file. Returns null when the selection's first line
	// is not currently visible.
	useLayoutEffect(() => {
		const view = viewRef.current
		const container = containerRef.current
		if (!view || !container || !selectionRange) {
			setButtonTop(null)
			return
		}

		const update = () => {
			const v = viewRef.current
			const c = containerRef.current
			if (!v || !c) return
			const sel = v.state.selection.main
			if (sel.from === sel.to) {
				setButtonTop(null)
				return
			}
			const coords = v.coordsAtPos(sel.from)
			if (!coords) {
				setButtonTop(null)
				return
			}
			const rect = c.getBoundingClientRect()
			const top = coords.top - rect.top
			// Hide when the first selected line is scrolled off either edge.
			if (top < 0 || top > rect.height - 8) {
				setButtonTop(null)
				return
			}
			setButtonTop(top)
		}

		update()
		view.scrollDOM.addEventListener("scroll", update, { passive: true })
		const ro = new ResizeObserver(update)
		ro.observe(container)
		return () => {
			view.scrollDOM.removeEventListener("scroll", update)
			ro.disconnect()
		}
	}, [selectionRange])

	// Reconfigure read-only when the prop flips (no full re-mount needed).
	useEffect(() => {
		const view = viewRef.current
		if (!view) return
		view.dispatch({
			effects: readOnlyCompartment.current.reconfigure(EditorState.readOnly.of(readOnly)),
		})
	}, [readOnly])

	// Mouse-drag tracking: while the user is dragging on the editor we
	// suppress the floating button so it doesn't flicker for every
	// intermediate selection state. Listen on `document` for mouseup so
	// drags that release outside the editor still clear the flag.
	useEffect(() => {
		const container = containerRef.current
		if (!container) return
		const onDown = (e: MouseEvent) => {
			if (container.contains(e.target as Node)) setIsDragging(true)
		}
		const onUp = () => setIsDragging(false)
		document.addEventListener("mousedown", onDown)
		document.addEventListener("mouseup", onUp)
		return () => {
			document.removeEventListener("mousedown", onDown)
			document.removeEventListener("mouseup", onUp)
		}
	}, [])

	// Reset post-add state whenever the user makes a new selection so the
	// button reappears for the next slice. Cancel any pending success-fade
	// timer so a stale callback doesn't re-hide the just-shown button.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run on selection change
	useEffect(() => {
		setJustAdded(false)
		setConsumed(false)
		if (successTimerRef.current !== null) {
			clearTimeout(successTimerRef.current)
			successTimerRef.current = null
		}
	}, [selectionRange])

	// Sync content + language → editor. Scroll resets on file switch
	// (path change); same-path content updates preserve scroll so file
	// watcher reloads don't yank the user away.
	useEffect(() => {
		const view = viewRef.current
		if (!view) return

		const normalized = content.replace(/\r\n/g, "\n")
		const current = view.state.doc.toString()
		if (current !== normalized) {
			applyingExternalRef.current = true
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: normalized },
			})
			applyingExternalRef.current = false
		}

		if (prevPathRef.current !== path) {
			view.scrollDOM.scrollTo({ top: 0, left: 0 })
			prevPathRef.current = path
		}

		applyShikiHighlights(view, normalized, language || "text").catch((err) =>
			console.error("[codemirror-viewer] highlight failed:", err),
		)
	}, [content, language, path])

	const handleAddSelectionToChat = () => {
		const view = viewRef.current
		if (!view || !selectionRange) return
		const sel = view.state.selection.main
		if (sel.from === sel.to) return
		const text = view.state.doc.sliceString(sel.from, sel.to)
		attachmentBridge.pushSelection({
			originalPath: path,
			startLine: selectionRange.startLine,
			endLine: selectionRange.endLine,
			text,
		})
		setJustAdded(true)
		if (successTimerRef.current !== null) clearTimeout(successTimerRef.current)
		// Show the success label briefly, then hide the button entirely
		// until the user's next selection (handled by the [selectionRange]
		// effect resetting `consumed`).
		successTimerRef.current = setTimeout(() => {
			setJustAdded(false)
			setConsumed(true)
			successTimerRef.current = null
		}, 1200)
	}

	const buttonVisible =
		selectionRange !== null &&
		!searchOpen &&
		buttonTop !== null &&
		!consumed &&
		(justAdded || !isDragging)

	return (
		<div className="relative h-full w-full">
			<div ref={containerRef} className="h-full w-full overflow-hidden" />
			<SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} viewRef={viewRef} />
			{buttonVisible && selectionRange && (
				<button
					type="button"
					onMouseDown={(e) => {
						// Prevent the editor from collapsing the selection on focus
						// stealing before our click handler has a chance to fire.
						e.preventDefault()
					}}
					onClick={handleAddSelectionToChat}
					disabled={justAdded}
					className="absolute right-3 z-10 flex cursor-pointer items-center gap-1.5 rounded-md border border-border/60 bg-overlay px-2.5 py-1 text-[11px] text-foreground shadow-[var(--shadow-dropdown)] transition-colors hover:bg-surface-hover disabled:cursor-default"
					style={{ top: `${buttonTop}px` }}
					title={
						justAdded
							? "Selection added to chat"
							: `Add lines ${selectionRange.startLine}-${selectionRange.endLine} of ${path.split("/").pop() ?? path} to chat`
					}
				>
					<Chat className="h-3 w-3" aria-hidden="true" />
					{justAdded ? "Successfully added" : "Add to Chat"}
				</button>
			)}
		</div>
	)
}
