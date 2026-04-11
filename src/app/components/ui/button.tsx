import { Button as HeroButton } from "@heroui/react"
import type { ComponentProps, MouseEventHandler } from "react"
import { cn } from "./cn"

const variantMap = {
	default: "primary",
	ghost: "ghost",
	outline: "outline",
	destructive: "danger",
} as const

export type ButtonVariant = keyof typeof variantMap
export type ButtonSize = "sm" | "md" | "lg"

type HeroButtonProps = ComponentProps<typeof HeroButton>

export interface ButtonProps extends Omit<HeroButtonProps, "variant" | "onClick"> {
	variant?: ButtonVariant
	size?: ButtonSize
	onClick?: MouseEventHandler<HTMLButtonElement>
	disabled?: boolean
}

/**
 * Thin wrapper over HeroUI Button that maps legacy variant names
 * and onClick → onPress for backward compatibility.
 */
export function Button({
	variant = "default",
	onClick,
	disabled,
	className,
	...props
}: ButtonProps) {
	return (
		<HeroButton
			variant={variantMap[variant]}
			onPress={() => onClick?.(null as any)}
			isDisabled={disabled}
			className={cn(
				"el-btn-pill",
				variant === "ghost" && "!bg-transparent !shadow-none hover:!bg-[var(--app-surface-hover)]",
				variant === "outline" && "!bg-transparent !shadow-[var(--shadow-inset)]",
				className,
			)}
			{...props}
		/>
	)
}
