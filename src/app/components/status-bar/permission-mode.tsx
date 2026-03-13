import { cn } from "../ui/cn"

export type PermissionModeValue = "default" | "ask-always" | "allow-all"

export interface PermissionModeProps {
	value: PermissionModeValue
	onChange: (mode: PermissionModeValue) => void
	className?: string
}

const PERMISSION_LABELS: Record<PermissionModeValue, string> = {
	default: "Default permissions",
	"ask-always": "Ask always",
	"allow-all": "Allow all",
}

/** Inline permission mode selector styled for the status bar. */
export function PermissionMode({ value, onChange, className }: PermissionModeProps) {
	return (
		<div className={cn("flex items-center gap-1.5 text-xs text-muted", className)}>
			<svg
				width="12"
				height="12"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
			</svg>
			<select
				value={value}
				onChange={(e) => onChange(e.target.value as PermissionModeValue)}
				className="cursor-pointer appearance-none border-none bg-background pr-3 text-xs text-muted outline-none hover:text-foreground"
				aria-label="Permission mode"
			>
				{Object.entries(PERMISSION_LABELS).map(([val, label]) => (
					<option key={val} value={val}>
						{label}
					</option>
				))}
			</select>
			<svg
				width="10"
				height="10"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.5"
				className="-ml-4"
				aria-hidden="true"
			>
				<path d="M6 9l6 6 6-6" />
			</svg>
		</div>
	)
}
