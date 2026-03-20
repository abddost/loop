import type { EditPart } from "@core/schema"
import { Button } from "../ui/button"
import { cn } from "../ui/cn"
import { FileReference } from "./file-reference"

export interface EditDiffProps {
	part: EditPart
	onUndo?: (hash: string) => void
	className?: string
}

/**
 * File change display showing changed files count and an undo button.
 */
export function EditDiff({ part, onUndo, className }: EditDiffProps) {
	const fileCount = part.files.length

	return (
		<div className={cn("rounded-[--radius-md] border border-border p-3", className)}>
			<div className="flex items-center justify-between">
				<span className="text-sm text-foreground">
					{fileCount} file{fileCount !== 1 ? "s" : ""} changed
				</span>
				{onUndo && (
					<Button variant="ghost" size="sm" onClick={() => onUndo(part.hash)}>
						Undo {"\u21BA"}
					</Button>
				)}
			</div>
			<ul className="mt-2 space-y-1">
				{part.files.map((file) => (
					<li key={file} className="truncate text-xs text-muted-foreground">
						<FileReference path={file} />
					</li>
				))}
			</ul>
		</div>
	)
}
