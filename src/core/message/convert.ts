import type {
	FilePart as AIFilePart,
	ImagePart as AIImagePart,
	TextPart as AITextPart,
	AssistantModelMessage,
	ModelMessage,
	ToolModelMessage,
	UserModelMessage,
} from "ai"
import type { MessageWithParts } from "../schema/message"
import type { FilePart, Part } from "../schema/part"

type UserContentItem = AITextPart | AIImagePart | AIFilePart

// ─── Truncation constants (mirrors read tool limits) ─────────

const MAX_LINES = 2000
const MAX_BYTES = 50 * 1024
const MAX_LINE_LENGTH = 2000

// ─── Data URL helpers ────────────────────────────────────────

const DATA_URL_RE = /^data:([^;,]+)?(?:;base64)?,/

function extractBase64(dataUrl: string): string | undefined {
	const idx = dataUrl.indexOf(",")
	if (idx === -1) return undefined
	const base64 = dataUrl.slice(idx + 1)
	return base64.length > 0 ? base64 : undefined
}

function decodeBase64Text(base64: string): string {
	try {
		return atob(base64)
	} catch {
		return ""
	}
}

/**
 * Truncate text file content to prevent context window exhaustion.
 * Matches the read tool's format: numbered lines, per-line truncation,
 * 2000-line cap, and 50 KB byte cap.
 */
function truncateTextContent(raw: string): string {
	const lines = raw.split("\n")
	const encoder = new TextEncoder()
	const output: string[] = []
	let bytes = 0

	const lineLimit = Math.min(lines.length, MAX_LINES)
	for (let i = 0; i < lineLimit; i++) {
		const line =
			lines[i].length > MAX_LINE_LENGTH ? `${lines[i].slice(0, MAX_LINE_LENGTH)}...` : lines[i]
		const formatted = `${i + 1}: ${line}`
		const lineBytes = encoder.encode(`${formatted}\n`).byteLength
		if (bytes + lineBytes > MAX_BYTES && output.length > 0) {
			output.push("...[output truncated due to size]")
			break
		}
		output.push(formatted)
		bytes += lineBytes
	}

	if (lines.length > MAX_LINES) {
		output.push(
			`\n...[${lines.length - MAX_LINES} more lines not shown, use the Read tool to see the full file]`,
		)
	}

	return output.join("\n")
}

// ─── User part conversion ────────────────────────────────────

function userPartToContent(part: Part): UserContentItem[] {
	switch (part.type) {
		case "text":
			return [{ type: "text", text: part.text }]

		case "file":
			return filePartToContent(part)

		case "subtask":
			return [
				{
					type: "text",
					text: `[Tool executed by user: ${part.agent} — ${part.description}${part.command ? ` (${part.command})` : ""}]`,
				},
			]

		case "compaction":
			return [
				{
					type: "text",
					text: "Here is a summary of what we have done so far. Continue from where we left off.",
				},
			]

		default:
			return []
	}
}

function filePartToContent(part: FilePart): UserContentItem[] {
	const mime = part.mimeType
	const content = part.content

	// Directories: content is enriched server-side (see enrich-files.ts)
	if (mime === "application/x-directory") {
		if (content) {
			return [{ type: "text", text: content }]
		}
		return [{ type: "text", text: `[Directory: ${part.path}]` }]
	}

	// Content enriched server-side as plain text (not a data URL)
	if (content && !DATA_URL_RE.test(content)) {
		return [{ type: "text", text: content }]
	}

	if (!content) {
		return [
			{
				type: "text",
				text: `ERROR: File "${part.path}" has no content. It may have failed to upload. Ask the user to re-attach it.`,
			},
		]
	}

	const base64 = extractBase64(content)
	if (!base64) {
		return [
			{
				type: "text",
				text: `ERROR: File "${part.path}" is empty or corrupted. Ask the user to re-attach it.`,
			},
		]
	}

	// Images (exclude SVG — treat as text)
	if (mime.startsWith("image/") && mime !== "image/svg+xml") {
		return [
			{ type: "text", text: `[Attached image: ${part.path}]` },
			{ type: "image", image: base64, mediaType: mime },
		]
	}

	// Text files — truncate with line numbers for consistency with Read tool
	if (mime === "text/plain" || mime.startsWith("text/") || mime === "image/svg+xml") {
		const text = decodeBase64Text(base64)
		if (text) {
			const truncated = truncateTextContent(text)
			const totalLines = text.split("\n").length
			const shownLines = Math.min(totalLines, MAX_LINES)
			const footer =
				totalLines > shownLines
					? `--- End of file (showing ${shownLines}/${totalLines} lines) ---`
					: "--- End of file ---"
			return [{ type: "text", text: `--- File: ${part.path} ---\n${truncated}\n${footer}` }]
		}
		return [
			{
				type: "text",
				text: `ERROR: Could not decode text content of "${part.path}". Ask the user to re-attach it.`,
			},
		]
	}

	// PDFs
	if (mime === "application/pdf") {
		return [
			{ type: "text", text: `[Attached PDF: ${part.path}]` },
			{ type: "file", data: base64, mediaType: mime, filename: part.path },
		]
	}

	// General fallback for other binary files
	return [
		{ type: "text", text: `[Attached file: ${part.path} (${mime})]` },
		{ type: "file", data: base64, mediaType: mime, filename: part.path },
	]
}

// ─── Assistant part conversion ───────────────────────────────

function assistantPartsToContent(parts: Part[]): {
	content: AssistantModelMessage["content"]
	toolResults: ToolModelMessage["content"]
} {
	const content: NonNullable<Exclude<AssistantModelMessage["content"], string>> = []
	const toolResults: ToolModelMessage["content"] = []

	for (const part of parts) {
		switch (part.type) {
			case "text":
				content.push({ type: "text" as const, text: part.text })
				break
			case "reasoning":
				content.push({ type: "text" as const, text: part.text })
				break
			case "tool": {
				content.push({
					type: "tool-call" as const,
					toolCallId: part.callId,
					toolName: part.tool,
					input: part.input ?? {},
				})
				const outputText =
					part.time?.compacted === true
						? "[Old tool result content cleared]"
						: (part.output ?? part.error ?? "")
				toolResults.push({
					type: "tool-result" as const,
					toolCallId: part.callId,
					toolName: part.tool,
					output: { type: "text" as const, value: outputText },
				})
				break
			}
			default:
				break
		}
	}

	return { content, toolResults }
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Converts an array of MessageWithParts into Vercel AI SDK ModelMessage format.
 *
 * User messages produce content arrays that may include text, image, and file parts.
 * Assistant messages produce assistant + tool messages.
 */
export function toModelMessages(messages: MessageWithParts[]): ModelMessage[] {
	const result: ModelMessage[] = []

	for (const msg of messages) {
		if (msg.role === "user") {
			const contentItems: UserContentItem[] = []
			for (const part of msg.parts) {
				const items = userPartToContent(part)
				for (const item of items) {
					contentItems.push(item)
				}
			}
			if (contentItems.length > 0) {
				result.push({
					role: "user" as const,
					content: contentItems,
				} satisfies UserModelMessage)
			}
		} else {
			const { content, toolResults } = assistantPartsToContent(msg.parts)
			if (content.length > 0) {
				result.push({
					role: "assistant" as const,
					content,
				})
			}
			if (toolResults.length > 0) {
				result.push({
					role: "tool" as const,
					content: toolResults,
				})
			}
		}
	}

	return result
}
