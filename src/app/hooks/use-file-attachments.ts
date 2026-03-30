import { ulid } from "@core/id"
import { useCallback, useRef, useState } from "react"
import {
	detectMime,
	readFileAsDataUrl,
	validateFileSize,
	validateTotalSize,
} from "../lib/file-utils"

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
}

export interface UseFileAttachmentsReturn {
	attachments: PendingAttachment[]
	processing: boolean
	addFiles: (files: FileList | File[]) => Promise<void>
	addFolder: (name: string, fullPath: string) => void
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

	return { attachments, processing, addFiles, addFolder, removeAttachment, clearAttachments }
}
