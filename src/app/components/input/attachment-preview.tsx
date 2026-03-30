import { Folder } from "@openai/apps-sdk-ui/components/Icon"
import { memo, useCallback, useEffect, useState } from "react"
import type { PendingAttachment } from "../../hooks/use-file-attachments"
import { isImageMime } from "../../lib/file-utils"
import { cn } from "../ui/cn"

interface AttachmentPreviewProps {
	attachments: PendingAttachment[]
	onRemove: (id: string) => void
}

// ─── Image Lightbox ──────────────────────────────────────────

function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
	const [visible, setVisible] = useState(false)

	useEffect(() => {
		requestAnimationFrame(() => setVisible(true))
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") handleClose()
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	}, [])

	const handleClose = useCallback(() => {
		setVisible(false)
		setTimeout(onClose, 150)
	}, [onClose])

	return (
		// biome-ignore lint/a11y/useKeyWithClickEvents: Escape key handled via document listener
		// biome-ignore lint/a11y/useSemanticElements: custom lightbox overlay, not a native dialog
		<div
			role="dialog"
			aria-modal="true"
			aria-label={`Preview of ${alt}`}
			className={cn(
				"fixed inset-0 z-50 flex items-center justify-center p-8 transition-all duration-150",
				visible ? "bg-black/70 backdrop-blur-sm opacity-100" : "bg-black/0 opacity-0",
			)}
			onClick={handleClose}
		>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: click only prevents propagation */}
			<div
				className={cn(
					"relative max-h-[85vh] max-w-[85vw] transition-transform duration-150",
					visible ? "scale-100" : "scale-95",
				)}
				onClick={(e) => e.stopPropagation()}
			>
				<img
					src={src}
					alt={alt}
					className="max-h-[85vh] max-w-[85vw] rounded-lg object-contain shadow-2xl"
				/>
				<button
					type="button"
					onClick={handleClose}
					className="absolute -top-3 -right-3 flex h-7 w-7 items-center justify-center rounded-full bg-surface border border-border text-muted shadow-md transition-colors hover:bg-danger hover:text-white hover:border-danger"
					aria-label="Close preview"
				>
					<XIcon size={3} />
				</button>
			</div>
		</div>
	)
}

// ─── Chips ───────────────────────────────────────────────────

function ImageChip({
	attachment,
	onRemove,
}: { attachment: PendingAttachment; onRemove: (id: string) => void }) {
	const [lightbox, setLightbox] = useState(false)

	const handleRemove = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			onRemove(attachment.id)
		},
		[attachment.id, onRemove],
	)

	return (
		<>
			<div className="group/chip relative shrink-0 p-1">
				<button
					type="button"
					onClick={() => setLightbox(true)}
					className="block h-12 w-12 overflow-hidden rounded-lg border border-border bg-surface transition-all duration-150 hover:border-accent/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
				>
					<img
						src={attachment.dataUrl}
						alt={attachment.filename}
						className="h-full w-full object-cover"
						draggable={false}
					/>
				</button>
				<button
					type="button"
					onClick={handleRemove}
					className={cn(
						"absolute top-0 right-0 flex h-4.5 w-4.5 items-center justify-center rounded-full",
						"border border-border bg-surface text-muted shadow-sm",
						"opacity-0 transition-all duration-100 group-hover/chip:opacity-100",
						"hover:bg-danger hover:text-white hover:border-danger",
					)}
					aria-label={`Remove ${attachment.filename}`}
				>
					<XIcon size={2.5} />
				</button>
			</div>
			{lightbox && (
				<ImageLightbox
					src={attachment.dataUrl}
					alt={attachment.filename}
					onClose={() => setLightbox(false)}
				/>
			)}
		</>
	)
}

function FolderChip({
	attachment,
	onRemove,
}: { attachment: PendingAttachment; onRemove: (id: string) => void }) {
	const handleRemove = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			onRemove(attachment.id)
		},
		[attachment.id, onRemove],
	)

	return (
		<div className="group/chip relative shrink-0 p-1">
			<div
				className="flex h-8 max-w-[180px] items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 transition-colors duration-150 hover:border-accent/30"
				title={attachment.folderPath ?? attachment.filename}
			>
				<Folder className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
				<span className="truncate text-xs text-muted-foreground">{attachment.filename}</span>
			</div>
			<button
				type="button"
				onClick={handleRemove}
				className={cn(
					"absolute -top-0 -right-0 flex h-4.5 w-4.5 items-center justify-center rounded-full",
					"border border-border bg-surface text-muted shadow-sm",
					"opacity-0 transition-all duration-100 group-hover/chip:opacity-100",
					"hover:bg-danger hover:text-white hover:border-danger",
				)}
				aria-label={`Remove ${attachment.filename}`}
			>
				<XIcon size={2.5} />
			</button>
		</div>
	)
}

function FileChip({
	attachment,
	onRemove,
}: { attachment: PendingAttachment; onRemove: (id: string) => void }) {
	const handleRemove = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			onRemove(attachment.id)
		},
		[attachment.id, onRemove],
	)

	return (
		<div className="group/chip relative shrink-0 p-1">
			<div
				className="flex h-8 max-w-[180px] items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 transition-colors duration-150 hover:border-accent/30"
				title={attachment.filename}
			>
				<FileIcon className="h-3.5 w-3.5 shrink-0 text-muted" />
				<span className="truncate text-xs text-muted-foreground">{attachment.filename}</span>
			</div>
			<button
				type="button"
				onClick={handleRemove}
				className={cn(
					"absolute -top-0 -right-0 flex h-4.5 w-4.5 items-center justify-center rounded-full",
					"border border-border bg-surface text-muted shadow-sm",
					"opacity-0 transition-all duration-100 group-hover/chip:opacity-100",
					"hover:bg-danger hover:text-white hover:border-danger",
				)}
				aria-label={`Remove ${attachment.filename}`}
			>
				<XIcon size={2.5} />
			</button>
		</div>
	)
}

function AttachmentChip({
	attachment,
	onRemove,
}: { attachment: PendingAttachment; onRemove: (id: string) => void }) {
	if (attachment.isFolder) return <FolderChip attachment={attachment} onRemove={onRemove} />
	if (isImageMime(attachment.mimeType))
		return <ImageChip attachment={attachment} onRemove={onRemove} />
	return <FileChip attachment={attachment} onRemove={onRemove} />
}

// ─── Preview Strip ───────────────────────────────────────────

export const AttachmentPreview = memo(function AttachmentPreview({
	attachments,
	onRemove,
}: AttachmentPreviewProps) {
	if (attachments.length === 0) return null

	return (
		<div className="flex items-end gap-0.5 overflow-x-auto px-3 pt-3 scrollbar-thin">
			{attachments.map((a) => (
				<AttachmentChip key={a.id} attachment={a} onRemove={onRemove} />
			))}
		</div>
	)
})

// ─── Icons ───────────────────────────────────────────────────

function XIcon({ size = 2.5 }: { size?: number }) {
	return (
		<svg
			className={`h-${size} w-${size}`}
			style={{ height: `${size * 4}px`, width: `${size * 4}px` }}
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			strokeWidth={3}
			aria-hidden="true"
		>
			<path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
		</svg>
	)
}

function FileIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			fill="none"
			viewBox="0 0 24 24"
			stroke="currentColor"
			strokeWidth={1.5}
			aria-hidden="true"
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
			/>
		</svg>
	)
}
