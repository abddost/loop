import { useEffect, useState } from "react"
import { fetchProviderLogo, getProviderLogo } from "../../lib/provider-logos"
import { ProviderAvatar } from "../settings/shared"
import { cn } from "./cn"

// ─── Size Config ────────────────────────────────────────────────

const SIZE_MAP = {
	xs: "h-4 w-4",
	sm: "h-5 w-5",
	md: "h-7 w-7",
} as const

// ─── Component ──────────────────────────────────────────────────

export interface ProviderIconProps {
	providerId: string
	providerName: string
	size?: "xs" | "sm" | "md"
	className?: string
}

/** Whether a cached value is raw SVG text (vs a URL). */
function isSvgContent(value: string): boolean {
	return value.trimStart().startsWith("<")
}

/**
 * Renders a provider logo from the shared cache, with graceful fallback
 * to a letter-based avatar. Logos are preloaded during bootstrap.
 *
 * Fetched SVGs are rendered inline so `currentColor` adapts to light/dark themes.
 * Local asset URLs (e.g. cursor) are rendered via <img>.
 */
export function ProviderIcon({
	providerId,
	providerName,
	size = "sm",
	className,
}: ProviderIconProps) {
	const cls = SIZE_MAP[size]

	// Try synchronous cache hit first (fast path after bootstrap preload)
	const cached = getProviderLogo(providerId)
	const [logo, setLogo] = useState<string | null>(cached)

	useEffect(() => {
		if (logo) return

		// Check if cache was populated since mount (e.g. by another component)
		const fresh = getProviderLogo(providerId)
		if (fresh) {
			setLogo(fresh)
			return
		}

		// Fetch as fallback (shouldn't happen after bootstrap, but safety net)
		fetchProviderLogo(providerId).then((result) => {
			if (result !== "error") setLogo(result)
		})
	}, [providerId, logo])

	if (logo) {
		// Raw SVG text → render inline for currentColor theme support
		if (isSvgContent(logo)) {
			return (
				<span
					role="img"
					aria-label={providerName}
					className={cn(
						cls,
						"inline-flex shrink-0 items-center justify-center text-foreground [&>svg]:h-full [&>svg]:w-full",
						className,
					)}
					// biome-ignore lint/security/noDangerouslySetInnerHtml: SVGs are sanitized in provider-logos.ts before caching
					dangerouslySetInnerHTML={{ __html: logo }}
				/>
			)
		}

		// URL (local asset like cursor) → render as <img>
		return (
			<img
				src={logo}
				alt={providerName}
				className={cn(cls, "shrink-0 rounded object-contain", className)}
			/>
		)
	}

	// Fallback: letter avatar
	const avatarSize = size === "md" ? "md" : "sm"
	return (
		<ProviderAvatar letter={providerName.charAt(0)} providerId={providerId} size={avatarSize} />
	)
}
