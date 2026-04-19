import {
	type BundledLanguage,
	type Highlighter,
	type ThemeRegistrationRaw,
	createHighlighter,
} from "shiki"

// ── Theme ──────────────────────────────────────────────────────────
//
// Full TextMate theme with real hex colors for accurate scope resolution.
// After highlighting, hex values are swapped for CSS custom properties
// so light/dark switches need zero re-highlighting.
//
// Unlike createCssVariablesTheme (which reduces all scopes to ~10
// token types), this uses the full TextMate scope system so keywords,
// storage types, functions, types, etc. each get distinct colors.

/**
 * Internal hex palette — one unique color per semantic category.
 * Used both in the theme definition and in the color-to-CSS-variable map.
 */
const HEX = {
	fg: "#d4d4d4",
	bg: "#1a1a1a",
	comment: "#6a9955",
	string: "#ce9178",
	keyword: "#c586c0",
	storage: "#569cd6",
	fn: "#dcdcaa",
	type: "#4ec9b0",
	variable: "#9cdcfe",
	constant: "#4fc1ff",
	number: "#b5cea8",
	punctuation: "#808080",
	regex: "#d16969",
} as const

/** Maps internal hex → CSS variable reference for post-processing. */
const COLOR_REPLACEMENTS: [string, string][] = [
	[HEX.comment, "var(--syntax-comment)"],
	[HEX.string, "var(--syntax-string)"],
	[HEX.keyword, "var(--syntax-keyword)"],
	[HEX.storage, "var(--syntax-storage)"],
	[HEX.fn, "var(--syntax-function)"],
	[HEX.type, "var(--syntax-type)"],
	[HEX.variable, "var(--syntax-variable)"],
	[HEX.constant, "var(--syntax-constant)"],
	[HEX.number, "var(--syntax-number)"],
	[HEX.punctuation, "var(--syntax-punctuation)"],
	[HEX.regex, "var(--syntax-regex)"],
	[HEX.fg, "var(--syntax-foreground)"],
	[HEX.bg, "var(--syntax-background)"],
]

/**
 * Theme uses the `settings` array (vscode-textmate native format).
 * First entry (no scope) defines global foreground/background.
 * Subsequent entries map TextMate scopes to colors.
 */
const LOOP_THEME: ThemeRegistrationRaw = {
	name: "loop",
	type: "dark",
	colors: {
		"editor.background": HEX.bg,
		"editor.foreground": HEX.fg,
	},
	settings: [
		// ── Global defaults ──────────────────────────────────────
		{
			settings: {
				foreground: HEX.fg,
				background: HEX.bg,
			},
		},

		// ── Comments ─────────────────────────────────────────────
		{
			scope: ["comment", "punctuation.definition.comment"],
			settings: { foreground: HEX.comment, fontStyle: "italic" },
		},

		// ── Strings ──────────────────────────────────────────────
		{
			scope: [
				"string",
				"string.quoted",
				"string.template",
				"string.quoted.single",
				"string.quoted.double",
			],
			settings: { foreground: HEX.string },
		},

		// ── Template string interpolation ────────────────────────
		{
			scope: ["punctuation.definition.template-expression", "meta.template.expression"],
			settings: { foreground: HEX.keyword },
		},

		// ── Keywords (control flow: if, else, return, import) ────
		{
			scope: [
				"keyword",
				"keyword.control",
				"keyword.control.import",
				"keyword.control.export",
				"keyword.control.from",
				"keyword.control.flow",
				"keyword.control.conditional",
				"keyword.control.loop",
				"keyword.control.trycatch",
				"keyword.operator.expression",
				"keyword.operator.new",
				"keyword.operator.delete",
				"keyword.operator.typeof",
				"keyword.operator.instanceof",
				"keyword.operator.in",
				"keyword.operator.of",
				"keyword.operator.logical.python",
			],
			settings: { foreground: HEX.keyword },
		},

		// ── Storage (declarations: const, let, function, class) ──
		{
			scope: [
				"storage",
				"storage.type",
				"storage.modifier",
				"storage.type.function",
				"storage.type.class",
				"storage.type.interface",
				"storage.type.type",
				"storage.type.enum",
			],
			settings: { foreground: HEX.storage },
		},

		// ── Functions ────────────────────────────────────────────
		{
			scope: [
				"entity.name.function",
				"support.function",
				"meta.function-call entity.name.function",
				"entity.name.function.member",
				"support.function.builtin",
			],
			settings: { foreground: HEX.fn },
		},

		// ── Types & classes ──────────────────────────────────────
		{
			scope: [
				"entity.name.type",
				"entity.name.class",
				"entity.name.namespace",
				"entity.name.interface",
				"support.type",
				"support.class",
				"entity.other.inherited-class",
			],
			settings: { foreground: HEX.type },
		},

		// ── Variables & parameters ───────────────────────────────
		{
			scope: [
				"variable",
				"variable.parameter",
				"variable.other",
				"variable.other.readwrite",
				"variable.other.assignment",
				"variable.other.property",
				"variable.other.object.property",
				"meta.definition.variable",
				"entity.other.attribute-name",
			],
			settings: { foreground: HEX.variable },
		},

		// ── Constants (true, false, null, undefined) ─────────────
		{
			scope: [
				"variable.other.constant",
				"constant.language",
				"constant.language.boolean",
				"constant.language.null",
				"constant.language.undefined",
				"support.constant",
			],
			settings: { foreground: HEX.constant },
		},

		// ── Numbers ──────────────────────────────────────────────
		{
			scope: [
				"constant.numeric",
				"constant.numeric.integer",
				"constant.numeric.float",
				"constant.numeric.hex",
			],
			settings: { foreground: HEX.number },
		},

		// ── Operators ────────────────────────────────────────────
		{
			scope: [
				"keyword.operator",
				"keyword.operator.assignment",
				"keyword.operator.arithmetic",
				"keyword.operator.comparison",
				"keyword.operator.logical",
				"keyword.operator.ternary",
				"keyword.operator.spread",
			],
			settings: { foreground: HEX.fg },
		},

		// ── Punctuation ──────────────────────────────────────────
		{
			scope: [
				"punctuation",
				"punctuation.definition.block",
				"punctuation.definition.parameters",
				"punctuation.separator",
				"punctuation.terminator",
				"meta.brace",
			],
			settings: { foreground: HEX.punctuation },
		},

		// ── HTML/JSX tags ────────────────────────────────────────
		{
			scope: ["entity.name.tag", "punctuation.definition.tag"],
			settings: { foreground: HEX.storage },
		},

		// ── Regex ────────────────────────────────────────────────
		{
			scope: ["string.regexp", "constant.other.character-class.regexp"],
			settings: { foreground: HEX.regex },
		},

		// ── Decorators / annotations ─────────────────────────────
		{
			scope: ["meta.decorator", "punctuation.decorator"],
			settings: { foreground: HEX.fn },
		},

		// ── JSON keys ────────────────────────────────────────────
		{
			scope: ["support.type.property-name.json"],
			settings: { foreground: HEX.variable },
		},

		// ── CSS selectors & properties ───────────────────────────
		{
			scope: ["entity.other.attribute-name.class.css", "entity.other.attribute-name.id.css"],
			settings: { foreground: HEX.fn },
		},
		{
			scope: ["support.type.property-name.css", "meta.property-name.css"],
			settings: { foreground: HEX.variable },
		},
		{
			scope: ["constant.other.color.rgb-value.hex.css", "support.constant.property-value.css"],
			settings: { foreground: HEX.constant },
		},

		// ── Markdown ─────────────────────────────────────────────
		{
			scope: ["markup.heading", "punctuation.definition.heading"],
			settings: { foreground: HEX.storage, fontStyle: "bold" },
		},
		{
			scope: ["markup.bold"],
			settings: { fontStyle: "bold" },
		},
		{
			scope: ["markup.italic"],
			settings: { fontStyle: "italic" },
		},
		{
			scope: ["markup.inline.raw", "markup.fenced_code"],
			settings: { foreground: HEX.string },
		},

		// ── Shell ────────────────────────────────────────────────
		{
			scope: ["variable.other.normal.shell", "punctuation.definition.variable.shell"],
			settings: { foreground: HEX.variable },
		},
	],
}

/**
 * Replace internal hex colors with CSS custom property references.
 * Handles both lowercase (from `colors{}`) and uppercase (from
 * vscode-textmate normalization of `settings[]`) hex values.
 */
function replaceColorsWithVars(html: string): string {
	let result = html
	for (const [hex, cssVar] of COLOR_REPLACEMENTS) {
		result = result.replaceAll(hex, cssVar)
		result = result.replaceAll(hex.toUpperCase(), cssVar)
	}
	return result
}

/** Fast hex → CSS variable lookup for per-token color resolution. */
const HEX_TO_CSS_VAR = new Map<string, string>()
for (const [hex, cssVar] of COLOR_REPLACEMENTS) {
	HEX_TO_CSS_VAR.set(hex, cssVar)
	HEX_TO_CSS_VAR.set(hex.toUpperCase(), cssVar)
}

const DEFAULT_COLOR = "var(--syntax-foreground)"

/** Resolve a hex token color to its CSS variable reference. */
function tokenColor(hex: string | undefined): string {
	if (!hex) return DEFAULT_COLOR
	return HEX_TO_CSS_VAR.get(hex) ?? HEX_TO_CSS_VAR.get(hex.toUpperCase()) ?? DEFAULT_COLOR
}

// ── Singleton ────────────────────────────────────────────────────

let instance: Promise<Highlighter> | null = null

/** Loaded language set — avoids redundant loadLanguage calls. */
const loaded = new Set<string>(["text", "plaintext", "txt"])

/**
 * Return (or create) the shared Shiki highlighter.
 * Languages are loaded on-demand to keep initial WASM payload small.
 * A rejected init is not cached — the next call will retry so a
 * transient failure (network, WASM compile) doesn't permanently
 * disable highlighting.
 */
export function getHighlighter(): Promise<Highlighter> {
	if (!instance) {
		instance = createHighlighter({ themes: [LOOP_THEME], langs: [] })
		instance.catch(() => {
			instance = null
		})
	}
	return instance
}

/**
 * Resolve a language identifier, load its grammar if needed, and return
 * the validated language name. Shared by highlightCode and highlightDiffLines.
 */
async function resolveLanguage(highlighter: Highlighter, lang: string): Promise<string> {
	let language = lang || "text"

	const { bundledLanguages } = await import("shiki")
	if (!(language in bundledLanguages)) {
		language = "text"
	}

	if (!loaded.has(language)) {
		await highlighter.loadLanguage(language as BundledLanguage)
		loaded.add(language)
	}

	return language
}

/**
 * Highlight a code string and return an HTML fragment.
 * Loads the requested language grammar on-demand if not yet loaded.
 * Falls back to plain text for unknown languages.
 */
export async function highlightCode(code: string, lang: string): Promise<string> {
	const highlighter = await getHighlighter()
	const language = await resolveLanguage(highlighter, lang)

	const html = highlighter.codeToHtml(code, {
		lang: language,
		theme: "loop",
	})

	return replaceColorsWithVars(html)
}

// ── Diff highlighting ───────────────────────────────────────────

/** A single token within a highlighted line. */
export interface DiffToken {
	content: string
	color: string
}

/** Common file extension → Shiki language mappings. */
const EXT_TO_LANG: Record<string, string> = {
	ts: "typescript",
	tsx: "tsx",
	js: "javascript",
	jsx: "jsx",
	mjs: "javascript",
	mts: "typescript",
	cjs: "javascript",
	cts: "typescript",
	py: "python",
	rb: "ruby",
	go: "go",
	rs: "rust",
	java: "java",
	kt: "kotlin",
	swift: "swift",
	c: "c",
	cpp: "cpp",
	cc: "cpp",
	h: "c",
	hpp: "cpp",
	cs: "csharp",
	css: "css",
	scss: "scss",
	less: "less",
	html: "html",
	vue: "vue",
	svelte: "svelte",
	json: "json",
	jsonc: "jsonc",
	yaml: "yaml",
	yml: "yaml",
	md: "markdown",
	mdx: "mdx",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	sql: "sql",
	toml: "toml",
	xml: "xml",
	svg: "xml",
	php: "php",
	lua: "lua",
	r: "r",
	scala: "scala",
	dart: "dart",
	zig: "zig",
	ex: "elixir",
	exs: "elixir",
	erl: "erlang",
	hs: "haskell",
	ml: "ocaml",
	clj: "clojure",
	tf: "hcl",
	proto: "protobuf",
	graphql: "graphql",
	gql: "graphql",
}

/** Exact filename → language for config-like files. */
const NAME_TO_LANG: Record<string, string> = {
	dockerfile: "dockerfile",
	makefile: "makefile",
	gnumakefile: "makefile",
	".gitignore": "bash",
	".env": "bash",
	".bashrc": "bash",
	".zshrc": "bash",
}

/**
 * Derive a Shiki language identifier from a file path.
 * Checks exact filename first, then falls back to extension mapping.
 */
export function langFromPath(filePath: string): string {
	const name = filePath.split("/").pop()?.toLowerCase() ?? ""
	if (NAME_TO_LANG[name]) return NAME_TO_LANG[name]
	const ext = name.includes(".") ? name.split(".").pop()! : ""
	return EXT_TO_LANG[ext] ?? "text"
}

/**
 * Tokenize an array of code lines with Shiki and return CSS-variable-
 * colored tokens per line. Used by DiffBlock for syntax-highlighted diffs.
 *
 * Returns null-equivalent (plain foreground tokens) for plain text or on error.
 */
export async function highlightDiffLines(lines: string[], lang: string): Promise<DiffToken[][]> {
	if (lang === "text" || lang === "plaintext" || lang === "txt" || lines.length === 0) {
		return lines.map((line) => [{ content: line, color: DEFAULT_COLOR }])
	}

	try {
		const highlighter = await getHighlighter()
		const language = await resolveLanguage(highlighter, lang)

		if (language === "text") {
			return lines.map((line) => [{ content: line, color: DEFAULT_COLOR }])
		}

		const code = lines.join("\n")
		const result = highlighter.codeToTokens(code, {
			lang: language as BundledLanguage,
			theme: "loop",
		})

		return result.tokens.map((lineTokens) =>
			lineTokens.map((t) => ({
				content: t.content,
				color: tokenColor(t.color),
			})),
		)
	} catch {
		// Graceful degradation — show plain text on any highlighting failure
		return lines.map((line) => [{ content: line, color: DEFAULT_COLOR }])
	}
}
