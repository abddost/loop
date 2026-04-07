import { getFileIconUrl } from "../../lib/file-icons"
import { cn } from "../ui/cn"

export interface FileIconProps {
	filePath: string
	className?: string
	size?: number
}

/** Material file-type icon resolved from the file path extension. */
export function FileIcon({ filePath, className, size = 16 }: FileIconProps) {
	const url = getFileIconUrl(filePath)
	if (!url) return null

	return (
		<img
			src={url}
			alt=""
			width={size}
			height={size}
			className={cn("shrink-0", className)}
			aria-hidden="true"
		/>
	)
}
