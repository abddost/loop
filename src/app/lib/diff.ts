/** Shared unified diff parser. */

export interface DiffLine {
	type: "add" | "remove" | "context" | "hunk"
	content: string
	oldLineNo?: number
	newLineNo?: number
	hunkHeader?: string
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/
const IMAGE_MARKER_RE = /\[Image[^\]]*\]/g

/** Parse a unified diff string into structured lines. */
export function parseDiff(raw: string): DiffLine[] {
	const lines = raw.split("\n")
	const result: DiffLine[] = []
	let oldLine = 0
	let newLine = 0

	for (const line of lines) {
		// Skip file headers and metadata
		if (
			line.startsWith("diff ") ||
			line.startsWith("index ") ||
			line.startsWith("--- ") ||
			line.startsWith("+++ ") ||
			line.startsWith("=== ") ||
			line.startsWith("\\ ")
		)
			continue

		// Skip empty lines before first hunk
		if (line === "" && result.length === 0) continue

		const hunkMatch = HUNK_RE.exec(line)
		if (hunkMatch) {
			oldLine = Number.parseInt(hunkMatch[1], 10)
			newLine = Number.parseInt(hunkMatch[2], 10)
			result.push({
				type: "hunk",
				content: "",
				hunkHeader: hunkMatch[3].trim() || undefined,
			})
			continue
		}

		const clean = (s: string) => s.replace(IMAGE_MARKER_RE, "").trimEnd()

		if (line.startsWith("+")) {
			result.push({ type: "add", content: clean(line.slice(1)), newLineNo: newLine++ })
		} else if (line.startsWith("-")) {
			result.push({ type: "remove", content: clean(line.slice(1)), oldLineNo: oldLine++ })
		} else {
			// Context line (leading space) or fallback
			result.push({
				type: "context",
				content: line.startsWith(" ") ? line.slice(1) : line,
				oldLineNo: oldLine++,
				newLineNo: newLine++,
			})
		}
	}

	return result
}
