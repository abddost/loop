import { ShieldCheck } from "@openai/apps-sdk-ui/components/Icon"
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
			<ShieldCheck className="h-3.5 w-3.5 shrink-0" role="img" aria-label="Permission mode" />
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
