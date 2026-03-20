import { PlusIcon } from "@heroicons/react/24/outline"
import { useCallback, useRef } from "react"

export interface AttachmentButtonProps {
	onAttach: (files: FileList) => void
}

/**
 * The + button that opens a file picker for attaching files.
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
				className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
				aria-label="Attach file"
			>
				<PlusIcon className="w-4 h-4" aria-hidden="true" />
			</button>
			<input ref={inputRef} type="file" multiple className="hidden" onChange={handleChange} />
		</>
	)
}
