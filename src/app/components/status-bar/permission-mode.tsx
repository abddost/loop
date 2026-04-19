import { ShieldCheck } from "@openai/apps-sdk-ui/components/Icon"
import { cn } from "../ui/cn"

/**
 * Permission mode values.
 *
 * The full union covers both AI SDK and Claude Code providers:
 *   - "default" / "full-access" — Loop's own tool permission system (AI SDK).
 *   - "auto-accept-edits" / "plan" — Claude Code SDK modes only.
 *
 * The status bar selector only shows modes relevant to AI SDK providers
 * ("Default" / "Full Access"). Claude Code sessions use the input-bar
 * PermissionModeSelector which shows all 4 modes.
 */
export type PermissionModeValue = "default" | "auto-accept-edits" | "full-access" | "plan"

export interface PermissionModeProps {
	value: PermissionModeValue
	onChange: (mode: PermissionModeValue) => void
	className?: string
}

/** Modes shown in the status bar (AI SDK providers only). */
const STATUS_BAR_MODES: Array<{ value: PermissionModeValue; label: string }> = [
	{ value: "default", label: "Default" },
	{ value: "full-access", label: "Full Access" },
]

export function PermissionMode({ value, onChange, className }: PermissionModeProps) {
	// Clamp to a valid status-bar mode. If the session has a Claude-Code-only
	// mode (e.g. "plan" from a prior provider switch), fall back to "default".
	const effectiveValue = STATUS_BAR_MODES.some((m) => m.value === value) ? value : "default"

	return (
		<div className={cn("flex items-center gap-1.5 text-xs text-muted", className)}>
			<ShieldCheck className="h-3.5 w-3.5 shrink-0" role="img" aria-label="Permission mode" />
			<select
				value={effectiveValue}
				onChange={(e) => onChange(e.target.value as PermissionModeValue)}
				className="cursor-pointer appearance-none border-none bg-transparent pr-3 text-xs text-muted outline-none hover:text-foreground"
				aria-label="Permission mode"
			>
				{STATUS_BAR_MODES.map((mode) => (
					<option key={mode.value} value={mode.value}>
						{mode.label}
					</option>
				))}
			</select>
		</div>
	)
}
