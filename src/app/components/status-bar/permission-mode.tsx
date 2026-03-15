import { cn } from "../ui/cn"

export type PermissionModeValue = "default" | "full-access"

export interface PermissionModeProps {
	value: PermissionModeValue
	onChange: (mode: PermissionModeValue) => void
	className?: string
}

const PERMISSION_LABELS: Record<PermissionModeValue, string> = {
	default: "Default",
	"full-access": "Full Access",
}

export function PermissionMode({ value, onChange, className }: PermissionModeProps) {
	return (
		<div className={cn("flex items-center gap-1.5 text-xs text-muted", className)}>
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				className="shrink-0"
				role="img"
				aria-label="Permission mode"
			>
				<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
			</svg>
			<select
				value={value}
				onChange={(e) => onChange(e.target.value as PermissionModeValue)}
				className="cursor-pointer appearance-none border-none bg-transparent pr-3 text-xs text-muted outline-none hover:text-foreground"
				aria-label="Permission mode"
			>
				{Object.entries(PERMISSION_LABELS).map(([val, label]) => (
					<option key={val} value={val}>
						{label}
					</option>
				))}
			</select>
		</div>
	)
}
