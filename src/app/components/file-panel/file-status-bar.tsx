import type { CursorInfo } from "./codemirror-viewer"

const LANGUAGE_LABEL: Record<string, string> = {
	typescript: "TypeScript",
	javascript: "JavaScript",
	tsx: "TypeScript JSX",
	jsx: "JavaScript JSX",
	python: "Python",
	rust: "Rust",
	go: "Go",
	java: "Java",
	c: "C",
	cpp: "C++",
	csharp: "C#",
	css: "CSS",
	scss: "SCSS",
	less: "Less",
	html: "HTML",
	vue: "Vue",
	svelte: "Svelte",
	json: "JSON",
	jsonc: "JSON with Comments",
	markdown: "Markdown",
	mdx: "MDX",
	yaml: "YAML",
	toml: "TOML",
	sql: "SQL",
	shell: "Shell",
	bash: "Shell",
	ruby: "Ruby",
	swift: "Swift",
	kotlin: "Kotlin",
	xml: "XML",
	graphql: "GraphQL",
	dockerfile: "Dockerfile",
	makefile: "Makefile",
	php: "PHP",
	lua: "Lua",
	r: "R",
	scala: "Scala",
	dart: "Dart",
	zig: "Zig",
	elixir: "Elixir",
	erlang: "Erlang",
	haskell: "Haskell",
	ocaml: "OCaml",
	clojure: "Clojure",
	hcl: "HCL",
	protobuf: "Protocol Buffers",
	text: "Plain Text",
	plaintext: "Plain Text",
}

interface FileStatusBarProps {
	language: string
	cursor: CursorInfo | null
	binary: boolean
	dirty: boolean
	saving: boolean
	saveError: string | null
}

export function FileStatusBar({
	language,
	cursor,
	binary,
	dirty,
	saving,
	saveError,
}: FileStatusBarProps) {
	const label = LANGUAGE_LABEL[language] ?? language ?? "Plain Text"
	const cursorText = cursor
		? cursor.selectionChars > 0
			? `Ln ${cursor.line}, Col ${cursor.col} (${cursor.selectionChars} selected)`
			: `Ln ${cursor.line}, Col ${cursor.col}`
		: null

	const stateLabel = saveError
		? { text: `Save failed: ${saveError}`, className: "text-error" }
		: saving
			? { text: "Saving…", className: "text-muted" }
			: binary
				? { text: "Binary", className: "text-muted/70" }
				: dirty
					? { text: "Modified", className: "text-warning" }
					: { text: "Saved", className: "text-muted/70" }

	return (
		<div className="flex h-6 shrink-0 items-center justify-between gap-3 border-t border-border/30 bg-surface px-3 text-[11px] text-muted">
			<div className="flex items-center gap-3 truncate">
				<span className="capitalize">{label}</span>
			</div>
			<div className="flex items-center gap-3 text-[11px]">
				{cursorText && <span className="tabular-nums">{cursorText}</span>}
				<span>UTF-8</span>
				<span className={stateLabel.className}>{stateLabel.text}</span>
			</div>
		</div>
	)
}
