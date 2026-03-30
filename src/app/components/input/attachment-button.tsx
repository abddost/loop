import { Plus } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useRef } from "react"
import { ACCEPTED_FILE_TYPES } from "../../lib/file-utils"

export interface AttachmentButtonProps {
	onAttach: (files: FileList) => void
}

const ACCEPT_STRING = ACCEPTED_FILE_TYPES.join(",")

/**
 * The + button that opens a file picker for attaching files.
 * Filters the OS picker to accepted file types (images, PDF, text, code).
 */
export function AttachmentButton({ onAttach }: AttachmentButtonProps) {
	const inputRef = useRef<HTMLInputElement>(null)

	const handleClick = useCallback(() => {
		inputRef.current?.click()
	}, [])

	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const files = e.target.files
			if (files && files.length > 0) {
				onAttach(files)
			}
			e.target.value = ""
		},
		[onAttach],
	)

	return (
		<>
			<button
				type="button"
				onClick={handleClick}
				className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:text-foreground"
				aria-label="Attach file"
			>
				<Plus className="w-4 h-4" aria-hidden="true" />
			</button>
			<input
				ref={inputRef}
				type="file"
				multiple
				accept={ACCEPT_STRING}
				className="hidden"
				onChange={handleChange}
			/>
		</>
	)
}
