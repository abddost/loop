/**
 * Read-only section displaying app info in card rows.
 */
export function AboutSection({ className }: { className?: string }) {
	return (
		<div className={className}>
			<div className="el-card divide-y divide-[var(--separator)] rounded-xl">
				<div className="flex items-center justify-between px-5 py-4">
					<span className="text-sm font-medium text-foreground">App</span>
					<span className="text-sm text-muted">Loop</span>
				</div>
				<div className="flex items-center justify-between px-5 py-4">
					<span className="text-sm font-medium text-foreground">Version</span>
					<span className="text-sm text-muted">0.1.0</span>
				</div>
			</div>
		</div>
	)
}
