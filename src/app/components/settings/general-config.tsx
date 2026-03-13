import { useAgentStore } from "../../stores/agent-store"
import { useConfigStore } from "../../stores/config-store"
import { useProviderStore } from "../../stores/provider-store"
import { cn } from "../ui/cn"
import { Select } from "../ui/select"

/**
 * General configuration using card-based grouped rows.
 * Each setting saves immediately on change via optimistic update.
 */
export function GeneralConfig({ className }: { className?: string }) {
	const config = useConfigStore((s) => s.config)
	const agents = useAgentStore((s) => s.agents)
	const connected = useProviderStore((s) => s.connected)
	const popular = useProviderStore((s) => s.popular)
	const other = useProviderStore((s) => s.other)
	const allProviders = [...connected, ...popular, ...other]

	const primaryAgents = agents.filter((a) => a.type === "primary")

	const handleThemeChange = (theme: string) => {
		const t = theme as "dark" | "light"
		useConfigStore.getState().update({ theme: t })
		document.documentElement.classList.toggle("dark", t === "dark")
		document.documentElement.classList.toggle("light", t === "light")
		document.documentElement.setAttribute("data-theme", t)
	}

	const handleDefaultAgentChange = (agentName: string) => {
		useConfigStore.getState().update({ defaultAgent: agentName })
	}

	const handleDefaultModelChange = (value: string) => {
		if (value === "auto") {
			useConfigStore.getState().update({ defaultModel: null })
			return
		}
		// value format: "providerId:modelId"
		const [providerId, modelId] = value.split(":")
		if (providerId && modelId) {
			useConfigStore.getState().update({ defaultModel: { providerId, modelId } })
		}
	}

	const defaultModelValue = config.defaultModel
		? `${config.defaultModel.providerId}:${config.defaultModel.modelId}`
		: "auto"

	return (
		<div className={className}>
			{/* General section */}
			<h1 className="mb-6 text-xl font-semibold text-foreground">General</h1>

			<div className="divide-y divide-border rounded-xl border border-border">
				{/* Default Agent */}
				{primaryAgents.length > 0 && (
					<SettingRow
						label="Default agent"
						description="The agent used for new sessions by default"
					>
						<Select
							value={config.defaultAgent}
							onChange={handleDefaultAgentChange}
							options={primaryAgents.map((agent) => ({
								value: agent.name,
								label: agent.name.charAt(0).toUpperCase() + agent.name.slice(1),
							}))}
							className="w-48"
						/>
					</SettingRow>
				)}

				{/* Default Model */}
				<SettingRow label="Default model" description="Choose which model to use for inference">
					<Select
						value={defaultModelValue}
						onChange={handleDefaultModelChange}
						options={[{ value: "auto", label: "Auto (first configured)" }]}
						groups={
							allProviders.length > 0
								? allProviders.map((provider) => ({
										label: provider.name,
										options: provider.models.map((model) => ({
											value: `${provider.id}:${model.id}`,
											label: model.name,
										})),
									}))
								: undefined
						}
						className="w-48"
					/>
				</SettingRow>
			</div>

			{/* Appearance section */}
			<h2 className="mb-4 mt-10 text-base font-semibold text-foreground">Appearance</h2>

			<div className="divide-y divide-border rounded-xl border border-border">
				<SettingRow label="Theme" description="Use light, dark, or match your system">
					<ThemeSegment value={config.theme} onChange={handleThemeChange} />
				</SettingRow>
			</div>
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

/** Segmented theme toggle: Light | Dark matching the screenshot. */
function ThemeSegment({
	value,
	onChange,
}: {
	value: string
	onChange: (value: string) => void
}) {
	const options = [
		{
			id: "light",
			label: "Light",
			icon: (
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<circle cx="12" cy="12" r="5" />
					<line x1="12" y1="1" x2="12" y2="3" />
					<line x1="12" y1="21" x2="12" y2="23" />
					<line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
					<line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
					<line x1="1" y1="12" x2="3" y2="12" />
					<line x1="21" y1="12" x2="23" y2="12" />
					<line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
					<line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
				</svg>
			),
		},
		{
			id: "dark",
			label: "Dark",
			icon: (
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
				</svg>
			),
		},
	]

	return (
		<div className="flex rounded-lg border border-border bg-segment-bg">
			{options.map((opt) => (
				<button
					key={opt.id}
					type="button"
					onClick={() => onChange(opt.id)}
					className={cn(
						"flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
						value === opt.id
							? "bg-surface-hover text-foreground"
							: "text-muted hover:text-foreground",
					)}
				>
					{opt.icon}
					<span>{opt.label}</span>
				</button>
			))}
		</div>
	)
}
