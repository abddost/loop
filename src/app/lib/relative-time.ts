/**
 * Format a timestamp into a compact relative time string.
 * Examples: "now", "2m", "1h", "3d", "2w", "1mo", "1y"
 */
export function formatRelativeTime(timestamp: number): string {
	const now = Date.now()
	const diffMs = now - timestamp

	if (diffMs < 0) return "now"

	const seconds = Math.floor(diffMs / 1000)
	const minutes = Math.floor(seconds / 60)
	const hours = Math.floor(minutes / 60)
	const days = Math.floor(hours / 24)
	const weeks = Math.floor(days / 7)
	const months = Math.floor(days / 30)
	const years = Math.floor(days / 365)

	if (years > 0) return `${years}y`
	if (months > 0) return `${months}mo`
	if (weeks > 0) return `${weeks}w`
	if (days > 0) return `${days}d`
	if (hours > 0) return `${hours}h`
	if (minutes > 0) return `${minutes}m`
	return "now"
}
