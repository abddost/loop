/**
 * Parse a shell command into top-level segments, respecting quotes and escapes.
 *
 * Splits on `;`, `&&`, `||`, `|`, and trailing `&` — the separators that
 * introduce new command invocations. Quoted strings and backslash escapes
 * are preserved so operators inside them are ignored.
 *
 * Also extracts `$(...)` and backtick sub-shell bodies as `subshells`, so
 * the permission layer can check nested commands separately from the outer
 * command that embeds them.
 *
 * The goal is defense-in-depth for permission matching: a user-approved
 * rule like `git pull` must not silently authorize `git pull && rm -rf /`.
 */
export interface ShellSplitResult {
	/** Top-level command segments, in order, with leading/trailing whitespace trimmed. */
	segments: string[]
	/** Sub-shell bodies found at any depth, in order of appearance. */
	subshells: string[]
}

export function splitBashCommand(input: string): ShellSplitResult {
	const segments: string[] = []
	const subshells: string[] = []
	let current = ""
	let i = 0
	const n = input.length

	while (i < n) {
		const c = input[i]

		// Backslash escape: keep next char as literal
		if (c === "\\" && i + 1 < n) {
			current += c + input[i + 1]
			i += 2
			continue
		}

		// Single-quoted string — no expansion, copy verbatim
		if (c === "'") {
			const start = i
			i++
			while (i < n && input[i] !== "'") i++
			current += input.slice(start, Math.min(i + 1, n))
			if (i < n) i++
			continue
		}

		// Double-quoted string — respects backslash escapes
		if (c === '"') {
			const start = i
			i++
			while (i < n && input[i] !== '"') {
				if (input[i] === "\\" && i + 1 < n) {
					i += 2
					continue
				}
				i++
			}
			current += input.slice(start, Math.min(i + 1, n))
			if (i < n) i++
			continue
		}

		// $(...) — capture sub-shell body recursively
		if (c === "$" && input[i + 1] === "(") {
			const openIndex = i
			i += 2
			const innerStart = i
			let depth = 1
			while (i < n && depth > 0) {
				const ch = input[i]
				if (ch === "\\" && i + 1 < n) {
					i += 2
					continue
				}
				if (ch === "'") {
					i++
					while (i < n && input[i] !== "'") i++
					if (i < n) i++
					continue
				}
				if (ch === '"') {
					i++
					while (i < n && input[i] !== '"') {
						if (input[i] === "\\" && i + 1 < n) {
							i += 2
							continue
						}
						i++
					}
					if (i < n) i++
					continue
				}
				if (ch === "$" && input[i + 1] === "(") {
					depth++
					i += 2
					continue
				}
				if (ch === ")") {
					depth--
					if (depth === 0) break
				}
				i++
			}
			const innerBody = input.slice(innerStart, i).trim()
			if (innerBody) {
				subshells.push(innerBody)
				// Recurse so deeply-nested subshells are all captured as segments/subshells.
				const nested = splitBashCommand(innerBody)
				for (const s of nested.segments) {
					if (s && !subshells.includes(s)) subshells.push(s)
				}
				for (const s of nested.subshells) {
					if (s && !subshells.includes(s)) subshells.push(s)
				}
			}
			current += input.slice(openIndex, Math.min(i + 1, n))
			if (i < n) i++
			continue
		}

		// Backtick sub-shell (legacy form)
		if (c === "`") {
			const openIndex = i
			i++
			const innerStart = i
			while (i < n && input[i] !== "`") {
				if (input[i] === "\\" && i + 1 < n) {
					i += 2
					continue
				}
				i++
			}
			const innerBody = input.slice(innerStart, i).trim()
			if (innerBody) {
				subshells.push(innerBody)
				const nested = splitBashCommand(innerBody)
				for (const s of nested.segments) {
					if (s && !subshells.includes(s)) subshells.push(s)
				}
				for (const s of nested.subshells) {
					if (s && !subshells.includes(s)) subshells.push(s)
				}
			}
			current += input.slice(openIndex, Math.min(i + 1, n))
			if (i < n) i++
			continue
		}

		// Top-level operators: ;, &&, ||, |, &
		if (c === ";") {
			pushSegment(segments, current)
			current = ""
			i++
			continue
		}
		if (c === "&" && input[i + 1] === "&") {
			pushSegment(segments, current)
			current = ""
			i += 2
			continue
		}
		if (c === "|" && input[i + 1] === "|") {
			pushSegment(segments, current)
			current = ""
			i += 2
			continue
		}
		if (c === "|") {
			pushSegment(segments, current)
			current = ""
			i++
			continue
		}
		if (c === "&") {
			pushSegment(segments, current)
			current = ""
			i++
			continue
		}

		current += c
		i++
	}

	pushSegment(segments, current)
	return { segments, subshells }
}

function pushSegment(out: string[], seg: string): void {
	const trimmed = seg.trim()
	if (trimmed) out.push(trimmed)
}
