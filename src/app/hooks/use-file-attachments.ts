import { ulid } from "@core/id"
import { useCallback, useRef, useState } from "react"
import type { SelectionAttachment } from "../lib/attachment-bridge"
import {
	detectMime,
	readFileAsDataUrl,
	validateFileSize,
	validateTotalSize,
} from "../lib/file-utils"

export interface SelectionMeta {
	/** Source file path so the chip can render the right language icon. */
	originalPath: string
	/** 1-based inclusive line range. */
	startLine: number
	endLine: number
}

export interface PendingAttachment {
	id: string
	filename: string
	mimeType: string
	/** Empty string for folder attachments. */
	dataUrl: string
	size: number
	/** When true, this attachment represents a dropped directory (path-only). */
	isFolder?: boolean
	/** Full path for folder attachments (from webkitRelativePath or entry API). */
	folderPath?: string
	/**
	 * When set, this attachment is a code-selection slice. Carries the source
	 * path + line range so the chip renders the original file's icon and a
	 * line-range badge instead of the synthetic "(lines N-M)" filename.
	 */
	selection?: SelectionMeta
}

export interface UseFileAttachmentsReturn {
	attachments: PendingAttachment[]
	processing: boolean
	addFiles: (files: FileList | File[]) => Promise<void>
	addFolder: (name: string, fullPath: string) => void
	/** Attach a file by workspace path (no content upload). Used by internal
	 *  drags from the file tree where the server already has filesystem
	 *  access — only the path needs to round-trip. */
	addPathFile: (name: string, fullPath: string) => void
	/** Attach a code-selection slice from the file-panel editor. Encodes the
	 *  selected text as a `text/plain;base64` data URL so all four runtime
	 *  adapters (claude-code, cursor, opencode, ai-sdk) format it correctly
	 *  via their existing text-attachment branches. */
	addSelection: (selection: SelectionAttachment) => void
	removeAttachment: (id: string) => void
	clearAttachments: () => void
}

export function useFileAttachments(): UseFileAttachmentsReturn {
	const [attachments, setAttachments] = useState<PendingAttachment[]>([])
	const [processing, setProcessing] = useState(false)
	const attachmentsRef = useRef<PendingAttachment[]>([])

	const addFiles = useCallback(async (files: FileList | File[]) => {
		const fileArray = Array.from(files)
		if (fileArray.length === 0) return

		setProcessing(true)
		try {
			const accepted: PendingAttachment[] = []
			const warnings: string[] = []

			for (const file of fileArray) {
				const sizeCheck = validateFileSize(file)
				if (!sizeCheck.ok) {
					warnings.push(sizeCheck.error!)
					continue
				}

				const currentBytes = attachmentsRef.current.reduce((sum, a) => sum + a.size, 0)
				const pendingBytes = accepted.reduce((sum, a) => sum + a.size, 0)
				const totalCheck = validateTotalSize(currentBytes + pendingBytes, file.size)
				if (!totalCheck.ok) {
					warnings.push(totalCheck.error!)
					break
				}

				const isDuplicate =
					attachmentsRef.current.some((a) => a.filename === file.name && a.size === file.size) ||
					accepted.some((a) => a.filename === file.name && a.size === file.size)
				if (isDuplicate) continue

				const mime = await detectMime(file)
				if (!mime) {
					warnings.push(`${file.name}: unsupported or binary file.`)
					continue
				}

				const dataUrl = await readFileAsDataUrl(file, mime)
				if (!dataUrl) {
					warnings.push(`${file.name}: failed to read file.`)
					continue
				}

				accepted.push({
					id: ulid(),
					filename: file.name,
					mimeType: mime,
					dataUrl,
					size: file.size,
				})
			}

			if (warnings.length > 0) {
				console.warn("[attachments]", warnings.join(" | "))
			}

			if (accepted.length > 0) {
				setAttachments((prev) => {
					const next = [...prev, ...accepted]
					attachmentsRef.current = next
					return next
				})
			}
		} finally {
			setProcessing(false)
		}
	}, [])

	const addFolder = useCallback((name: string, fullPath: string) => {
		const isDuplicate = attachmentsRef.current.some((a) => a.isFolder && a.folderPath === fullPath)
		if (isDuplicate) return

		const folder: PendingAttachment = {
			id: ulid(),
			filename: name,
			mimeType: "application/x-directory",
			dataUrl: "",
			size: 0,
			isFolder: true,
			folderPath: fullPath,
		}
		setAttachments((prev) => {
			const next = [...prev, folder]
			attachmentsRef.current = next
			return next
		})
	}, [])

	const addPathFile = useCallback((name: string, fullPath: string) => {
		// Skip when the same path is already attached as a regular file ref.
		// Selections from the same file are NOT duplicates — they live alongside
		// full-file references — so exclude them from this check.
		const isDuplicate = attachmentsRef.current.some(
			(a) => !a.isFolder && !a.selection && a.folderPath === fullPath,
		)
		if (isDuplicate) return

		const fileRef: PendingAttachment = {
			id: ulid(),
			filename: name,
			// Path-only file reference — empty content lets the server
			// resolve the file from disk by `folderPath` (reused to carry
			// the absolute path).
			mimeType: "application/x-loop-path",
			dataUrl: "",
			size: 0,
			folderPath: fullPath,
		}
		setAttachments((prev) => {
			const next = [...prev, fileRef]
			attachmentsRef.current = next
			return next
		})
	}, [])

	const addSelection = useCallback((sel: SelectionAttachment) => {
		const basename = sel.originalPath.split("/").pop() ?? sel.originalPath
		const rangeLabel =
			sel.startLine === sel.endLine
				? `line ${sel.startLine}`
				: `lines ${sel.startLine}-${sel.endLine}`
		const filename = `${basename} (${rangeLabel})`

		// Same source + same range = already attached. Treat as a no-op
		// (no error, no toast — the user just clicked the button twice).
		const isDuplicate = attachmentsRef.current.some(
			(a) =>
				a.selection?.originalPath === sel.originalPath &&
				a.selection?.startLine === sel.startLine &&
				a.selection?.endLine === sel.endLine,
		)
		if (isDuplicate) return

		// Pre-format the selection with a clear header so every runtime
		// (claude-code / cursor / opencode / ai-sdk) hands the model the
		// same self-describing block once it decodes the data URL. The
		// raw text never appears as a bare string — agents need to know
		// it's a slice of a file at a specific range, not the full file.
		const framedText =
			`--- Selection from ${sel.originalPath} (${rangeLabel}) ---\n${sel.text}\n--- End of selection ---`
		const bytes = new TextEncoder().encode(framedText).byteLength
		const currentBytes = attachmentsRef.current.reduce((sum, a) => sum + a.size, 0)
		const totalCheck = validateTotalSize(currentBytes, bytes)
		if (!totalCheck.ok) {
			console.warn("[attachments]", totalCheck.error)
			return
		}

		// Browser-side base64 of UTF-8 text. btoa requires a Latin-1 string,
		// so we go through TextEncoder + a binary-string conversion.
		const dataUrl = textToDataUrl(framedText)
		if (!dataUrl) return

		const attachment: PendingAttachment = {
			id: ulid(),
			filename,
			mimeType: "text/plain",
			dataUrl,
			size: bytes,
			// Store the originalPath on `folderPath` too so input-bar's
			// submission helper (which already prefers folderPath over
			// filename) sends a real workspace path to the server instead
			// of the synthetic "basename (lines N-M)" label.
			folderPath: sel.originalPath,
			selection: {
				originalPath: sel.originalPath,
				startLine: sel.startLine,
				endLine: sel.endLine,
			},
		}

		setAttachments((prev) => {
			const next = [...prev, attachment]
			attachmentsRef.current = next
			return next
		})
	}, [])

	const removeAttachment = useCallback((id: string) => {
		setAttachments((prev) => {
			const next = prev.filter((a) => a.id !== id)
			attachmentsRef.current = next
			return next
		})
	}, [])

	const clearAttachments = useCallback(() => {
		setAttachments([])
		attachmentsRef.current = []
	}, [])

	return {
		attachments,
		processing,
		addFiles,
		addFolder,
		addPathFile,
		addSelection,
		removeAttachment,
		clearAttachments,
	}
}

/**
 * Encode an arbitrary UTF-8 string as a `text/plain;base64` data URL.
 * `btoa` requires a Latin-1 string, so we go through TextEncoder bytes
 * and a binary-string conversion.
 */
function textToDataUrl(text: string): string | null {
	try {
		const bytes = new TextEncoder().encode(text)
		let binary = ""
		const chunkSize = 0x8000
		for (let i = 0; i < bytes.length; i += chunkSize) {
			const chunk = bytes.subarray(i, i + chunkSize)
			binary += String.fromCharCode(...chunk)
		}
		return `data:text/plain;base64,${btoa(binary)}`
	} catch (err) {
		console.error("[attachments] failed to encode selection:", err)
		return null
	}
}
