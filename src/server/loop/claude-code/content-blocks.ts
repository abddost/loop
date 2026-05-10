import { decodeDataUrlText, looksLikeText, stripDataUrlPrefix } from "@core/message/data-url"
import type { FilePart, TextPart } from "@core/schema/part"

/**
 * Anthropic SDK content block shapes that the Claude Code `query()` accepts
 * inside `SDKUserMessage["message"]["content"]`. Mirrors what t3code emits
 * (see `apps/server/src/provider/Layers/ClaudeAdapter.ts` `buildClaude*ContentBlock`).
 */
export type SdkContentBlock =
	| { type: "text"; text: string }
	| { type: "image"; source: { type: "base64"; media_type: string; data: string } }
	| { type: "document"; source: { type: "base64"; media_type: string; data: string } }

const SUPPORTED_IMAGE_MIME = /^image\/(png|jpe?g|gif|webp)$/i

/**
 * Build the array of content blocks for a single SDK user message from the
 * latest user-message parts. Matches the conversion strategy used by the
 * cursor / opencode integrations but emits the Anthropic SDK shape.
 *
 * Rules:
 * - Text parts → `{ type: "text", text }` (skipping empty strings)
 * - Files with a supported image mime → `{ type: "image", source: base64 }`
 * - Files with `application/pdf` → `{ type: "document", source: base64 }`
 * - Files with `application/x-directory` → enriched directory listing
 *   embedded as a text block (truncated to 4 KB to mirror cursor behaviour)
 * - Files that look like text (text/* or json/yaml/etc.) → text block
 *   prefixed with `[File: <path>]\n`
 * - Anything else (binary, missing, unresolved) → `[Attached file: ...]`
 *   text fallback so file-only prompts still produce a non-empty content
 *   array and the model is at least aware the user attached something
 */
export function buildClaudeCodeContent(
	parts: ReadonlyArray<TextPart | FilePart>,
): SdkContentBlock[] {
	const blocks: SdkContentBlock[] = []
	for (const part of parts) {
		if (part.type === "text") {
			const text = part.text?.trim()
			if (text) blocks.push({ type: "text", text: part.text })
			continue
		}
		blocks.push(filePartToContentBlock(part))
	}
	return blocks
}

function filePartToContentBlock(file: FilePart): SdkContentBlock {
	const mime = file.mimeType
	const content = file.content

	// Empty content reaches us when server-side enrichment failed (file
	// missing, permission denied, oversized) — emit a marker so the
	// model still knows the user attached something and the runtime
	// doesn't trip the "No user prompt content" guard.
	if (!content) {
		return {
			type: "text",
			text: `[Attached file: ${file.path}${mime && mime !== "application/x-loop-path" ? ` (${mime})` : ""}]`,
		}
	}

	if (mime === "application/x-directory") {
		return {
			type: "text",
			text: `[Directory attached: ${file.path}]\n${content.slice(0, 4000)}`,
		}
	}

	if (SUPPORTED_IMAGE_MIME.test(mime)) {
		const data = stripDataUrlPrefix(content)
		return {
			type: "image",
			source: { type: "base64", media_type: mime.toLowerCase(), data },
		}
	}

	if (mime === "application/pdf") {
		const data = stripDataUrlPrefix(content)
		return {
			type: "document",
			source: { type: "base64", media_type: "application/pdf", data },
		}
	}

	if (looksLikeText(content)) {
		// Decode data URLs back to readable text so the model sees the
		// actual source (e.g. for "Add to chat" code selections that
		// arrive as `data:text/plain;base64,...`). Falls back to the
		// raw stripped payload only when decoding fails.
		const decoded = decodeDataUrlText(content)
		const text = decoded ?? stripDataUrlPrefix(content)
		return {
			type: "text",
			text: `[File: ${file.path}]\n${text}`,
		}
	}

	return {
		type: "text",
		text: `[Binary file: ${file.path}${mime ? ` (${mime})` : ""}]`,
	}
}
