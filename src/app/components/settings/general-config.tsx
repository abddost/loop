import { ArrowUpRight } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useEffect, useState } from "react"
import { apiClient } from "../../lib/api-client"
import { openFile } from "../../lib/editor"
import { useConfigStore } from "../../stores/config-store"
import { Select } from "../ui/select"
import { AboutSection } from "./about-section"

/**
 * General configuration using card-based grouped rows.
 * Each setting saves immediately on change via optimistic update.
 */
export function GeneralConfig({ className }: { className?: string }) {
	return (
		<div className={className}>
			{/* General section */}
			<h1 className="mb-6 text-xl font-semibold text-foreground">General</h1>

			{/* Reasoning section */}
			<ReasoningConfig />

			{/* Permissions section */}
			<PermissionsConfig />

			{/* About section */}
			<h2 className="mb-4 mt-10 text-base font-semibold text-foreground">About</h2>
			<AboutSection />
		</div>
	)
}

/** Single settings row: label + description left, control right. */
function SettingRow({
	label,
	description,
	children,
}: {
	label: string
	description: string
	children: React.ReactNode
}) {
	return (
		<div className="flex items-center justify-between gap-6 px-5 py-4">
			<div className="min-w-0">
				<div className="text-sm font-medium text-foreground">{label}</div>
				<div className="mt-0.5 text-xs text-muted">{description}</div>
			</div>
			<div className="shrink-0">{children}</div>
		</div>
	)
}

/** Reasoning defaults configuration section. */
function ReasoningConfig() {
	const config = useConfigStore((s) => s.config)

	const handleEffortChange = useCallback((value: string) => {
		useConfigStore.getState().update({
			reasoning: { effort: value as "low" | "medium" | "high" | "xhigh" | "max" | "ultrathink" },
		})
	}, [])

	const handleSummaryChange = useCallback((value: string) => {
		useConfigStore.getState().update({
			reasoning: { summary: value as "auto" | "concise" | "detailed" },
		})
	}, [])

	return (
		<>
			<h2 className="mb-1 mt-10 text-base font-semibold text-foreground">Codex Reasoning</h2>
			<p className="mb-4 text-xs text-muted">
				Controls reasoning behavior for OpenAI models that support extended thinking
			</p>
			<div className="el-card divide-y divide-[var(--separator)]">
				<SettingRow
					label="Default reasoning effort"
					description="How much the model thinks before responding"
				>
					<Select
						value={config.reasoning.effort}
						onChange={handleEffortChange}
						options={[
							{ value: "low", label: "Low" },
							{ value: "medium", label: "Medium" },
							{ value: "high", label: "High" },
							{ value: "xhigh", label: "Extra High" },
							{ value: "max", label: "Max" },
							{ value: "ultrathink", label: "Ultrathink" },
						]}
						className="w-48"
					/>
				</SettingRow>
				<SettingRow
					label="Reasoning summary"
					description="How reasoning steps are summarized (Codex models)"
				>
					<Select
						value={config.reasoning.summary}
						onChange={handleSummaryChange}
						options={[
							{ value: "auto", label: "Auto" },
							{ value: "concise", label: "Concise" },
							{ value: "detailed", label: "Detailed" },
						]}
						className="w-48"
					/>
				</SettingRow>
			</div>
		</>
	)
}

/** Permissions configuration section. */
function PermissionsConfig() {
	const config = useConfigStore((s) => s.config)
	const [configPath, setConfigPath] = useState<string | null>(null)

	useEffect(() => {
		apiClient
			.get<{ path: string }>("/config/path")
			.then((res) => setConfigPath(res.path))
			.catch(() => {})
	}, [])

	const handlePolicyChange = useCallback((value: string) => {
		const policy = value as "default" | "full-access"
		useConfigStore.getState().update({ permission: { approvalPolicy: policy } })
	}, [])

	const handleOpenConfig = useCallback(() => {
		if (!configPath) return
		openFile(configPath)
	}, [configPath])

	return (
		<>
			<div className="mb-4 mt-10 flex items-center justify-between">
				<h2 className="text-base font-semibold text-foreground">Permissions</h2>
				{configPath && (
					<button
						type="button"
						onClick={handleOpenConfig}
						className="el-btn-pill-sm flex items-center gap-1.5 !bg-transparent text-muted shadow-[var(--shadow-inset)] hover:text-foreground"
					>
						<span>Open config.json</span>
						<ArrowUpRight className="h-3 w-3" aria-hidden="true" />
					</button>
				)}
			</div>

			<div className="el-card divide-y divide-[var(--separator)]">
				<SettingRow label="Approval policy" description="Choose when Loop asks for approval">
					<Select
						value={config.permission.approvalPolicy}
						onChange={handlePolicyChange}
						options={[
							{ value: "default", label: "Default" },
							{ value: "full-access", label: "Full Access" },
						]}
						className="w-48"
					/>
				</SettingRow>

				{configPath && (
					<div className="px-5 py-3">
						<p className="text-xs text-muted">
							Fine-grained permission rules can be configured in{" "}
							<button
								type="button"
								onClick={handleOpenConfig}
								className="font-mono text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground"
							>
								{configPath}
							</button>
						</p>
					</div>
				)}
			</div>
		</>
	)
}
