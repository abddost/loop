import * as monaco from "monaco-editor"
import { useEffect, useRef } from "react"
import type { CursorInfo } from "./codemirror-viewer"

// ── Monaco environment setup ─────────────────────────────────────────
// Configure workers for syntax highlighting, validation, etc.

self.MonacoEnvironment = {
	getWorker(_workerId: string, label: string) {
		if (label === "json") {
			return new Worker(
				new URL("monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url),
				{ type: "module" },
			)
		}
		if (label === "css" || label === "scss" || label === "less") {
			return new Worker(
				new URL("monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url),
				{ type: "module" },
			)
		}
		if (label === "html" || label === "handlebars" || label === "razor") {
			return new Worker(
				new URL("monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url),
				{ type: "module" },
			)
		}
		if (label === "typescript" || label === "javascript") {
			return new Worker(
				new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url),
				{ type: "module" },
			)
		}
		return new Worker(new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url), {
			type: "module",
		})
	},
}

// ── Define custom dark theme ─────────────────────────────────────────

monaco.editor.defineTheme("loop-dark", {
	base: "vs-dark",
	inherit: true,
	rules: [],
	colors: {
		"editor.background": "#00000000",
		"editor.lineHighlightBackground": "#ffffff08",
		"editorLineNumber.foreground": "#555555",
		"editorLineNumber.activeForeground": "#888888",
		"editorCursor.foreground": "#aeafad",
		"editor.selectionBackground": "#264f78",
		"editor.inactiveSelectionBackground": "#3a3d41",
		"editorIndentGuide.background": "#404040",
		"editorIndentGuide.activeBackground": "#707070",
		"scrollbarSlider.background": "#79797966",
		"scrollbarSlider.hoverBackground": "#646464b3",
		"scrollbarSlider.activeBackground": "#bfbfbf66",
	},
})

// ── Language mapping ─────────────────────────────────────────────────

const LANGUAGE_MAP: Record<string, string> = {
	typescript: "typescript",
	javascript: "javascript",
	python: "python",
	rust: "rust",
	go: "go",
	java: "java",
	c: "c",
	cpp: "cpp",
	css: "css",
	html: "html",
	json: "json",
	markdown: "markdown",
	yaml: "yaml",
	toml: "toml",
	sql: "sql",
	shell: "shell",
	ruby: "ruby",
	swift: "swift",
	kotlin: "kotlin",
	xml: "xml",
	graphql: "graphql",
}

// ── Component ────────────────────────────────────────────────────────

interface MonacoEditorWrapperProps {
	content: string
	language: string
	path: string
	// Accepted (but ignored) for prop-shape parity with the CodeMirror viewer.
	// Monaco fallback is read-only; cursor reporting and edit hooks are handled
	// by the primary viewer.
	readOnly?: boolean
	onCursorChange?: (info: CursorInfo) => void
	onContentChange?: (content: string) => void
	onSave?: () => void
}

export default function MonacoEditorWrapper({ content, language, path }: MonacoEditorWrapperProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
	const modelRef = useRef<monaco.editor.ITextModel | null>(null)

	// Create editor on mount
	useEffect(() => {
		const container = containerRef.current
		if (!container) return

		const editor = monaco.editor.create(container, {
			theme: "loop-dark",
			readOnly: true,
			minimap: { enabled: false },
			scrollBeyondLastLine: false,
			fontSize: 13,
			fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
			lineNumbers: "on",
			renderLineHighlight: "line",
			smoothScrolling: true,
			cursorBlinking: "smooth",
			padding: { top: 8 },
			overviewRulerLanes: 0,
			hideCursorInOverviewRuler: true,
			overviewRulerBorder: false,
			scrollbar: {
				verticalScrollbarSize: 8,
				horizontalScrollbarSize: 8,
				useShadows: false,
			},
			wordWrap: "off",
			automaticLayout: true,
			contextmenu: false,
			folding: true,
			foldingStrategy: "indentation",
			links: true,
			bracketPairColorization: { enabled: true },
			guides: {
				indentation: true,
				bracketPairs: true,
			},
		})

		editorRef.current = editor

		// Resize observer for the container
		const resizeObserver = new ResizeObserver(() => {
			editor.layout()
		})
		resizeObserver.observe(container)

		return () => {
			resizeObserver.disconnect()
			editor.dispose()
			editorRef.current = null
		}
	}, [])

	// Update model when content/language/path changes
	useEffect(() => {
		const editor = editorRef.current
		if (!editor) return

		const monacoLang = LANGUAGE_MAP[language] ?? (language || "plaintext")
		const uri = monaco.Uri.parse(`file:///${path}`)

		// Reuse or create model
		let model = monaco.editor.getModel(uri)
		if (model) {
			if (model.getValue() !== content) {
				model.setValue(content)
			}
			if (model.getLanguageId() !== monacoLang) {
				monaco.editor.setModelLanguage(model, monacoLang)
			}
		} else {
			// Dispose previous model if it was for a different path
			if (modelRef.current) {
				modelRef.current.dispose()
			}
			model = monaco.editor.createModel(content, monacoLang, uri)
		}

		modelRef.current = model
		editor.setModel(model)
	}, [content, language, path])

	// Dispose model on unmount
	useEffect(() => {
		return () => {
			if (modelRef.current) {
				modelRef.current.dispose()
				modelRef.current = null
			}
		}
	}, [])

	return <div ref={containerRef} className="h-full w-full" />
}
