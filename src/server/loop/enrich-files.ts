import { readdir, stat } from "node:fs/promises"
import { isAbsolute, resolve } from "node:path"
import type { MessageWithParts } from "@core/schema/message"
import type { FilePart, Part } from "@core/schema/part"
import { createLogger } from "../logger"
import { Workspace } from "../workspace"

const log = createLogger("enrich-files")

const MAX_DIR_ENTRIES = 2000

/**
 * Enrich file parts in user messages with server-side content.
 *
 * Currently handles directory attachments: reads the directory listing
 * from disk and injects it as formatted text content so the model
 * can see the directory structure without needing a tool call.
 *
 * Operates on in-memory copies — does NOT mutate or persist changes.
 */
export async function enrichFileParts(messages: MessageWithParts[]): Promise<MessageWithParts[]> {
	const result: MessageWithParts[] = []

	for (const msg of messages) {
		if (msg.role !== "user" || !hasDirectoryParts(msg.parts)) {
			result.push(msg)
			continue
		}

		const enrichedParts: Part[] = []
		for (const part of msg.parts) {
			if (part.type === "file" && part.mimeType === "application/x-directory" && !part.content) {
				enrichedParts.push(await enrichDirectoryPart(part))
			} else {
				enrichedParts.push(part)
			}
		}

		result.push({ ...msg, parts: enrichedParts })
	}

	return result
}

function hasDirectoryParts(parts: Part[]): boolean {
	return parts.some(
		(p) => p.type === "file" && p.mimeType === "application/x-directory" && !p.content,
	)
}

async function enrichDirectoryPart(part: FilePart): Promise<FilePart> {
	const dirPath = isAbsolute(part.path) ? part.path : resolve(Workspace.dir(), part.path)

	try {
		const entries = await readdir(dirPath)
		const annotated: string[] = []

		for (const entry of entries.sort()) {
			if (annotated.length >= MAX_DIR_ENTRIES) {
				annotated.push(`...[${entries.length - MAX_DIR_ENTRIES} more entries not shown]`)
				break
			}
			try {
				const s = await stat(resolve(dirPath, entry))
				annotated.push(s.isDirectory() ? `${entry}/` : entry)
			} catch {
				annotated.push(entry)
			}
		}

		const listing = annotated.length > 0 ? annotated.join("\n") : "(empty directory)"

		return {
			...part,
			content: `--- Directory: ${part.path} ---\n${listing}\n--- End of directory listing ---`,
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		log.error("Failed to read directory for attachment", { path: part.path, error: msg })

		return {
			...part,
			content: `ERROR: Failed to read directory "${part.path}": ${msg}. Ask the user to verify the path exists.`,
		}
	}
}
