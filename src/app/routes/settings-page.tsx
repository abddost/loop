import {
	ArrowLeftIcon,
	BookOpenIcon,
	Cog6ToothIcon,
	ComputerDesktopIcon,
	CubeIcon,
	PaintBrushIcon,
	Square3Stack3DIcon,
	WrenchScrewdriverIcon,
} from "@heroicons/react/24/outline"
import { useNavigate } from "@tanstack/react-router"
import { useCallback, useState } from "react"
import { AppearanceConfig } from "../components/settings/appearance-config"
import { GeneralConfig } from "../components/settings/general-config"
import { McpConfig } from "../components/settings/mcp-config"
import { ModelsConfig } from "../components/settings/models-config"
import { ProviderConfig } from "../components/settings/provider-config"
import { SkillsConfig } from "../components/settings/skills-config"
import { cn } from "../components/ui/cn"
import { apiClient } from "../lib/api-client"
import { useProviderStore } from "../stores/provider-store"

type NavId =
	| "general"
	| "providers"
	| "models"
	| "appearance"
	| "mcp-servers"
	| "skills"
	| "git"
	| "environments"

interface NavItem {
	id: NavId
	label: string
	icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
	{
		id: "general",
		label: "General",
		icon: <Cog6ToothIcon className="h-4 w-4" aria-hidden="true" />,
	},
	{
		id: "providers",
		label: "Providers",
		icon: <Square3Stack3DIcon className="h-4 w-4" aria-hidden="true" />,
	},
	{
		id: "models",
		label: "Models",
		icon: <ComputerDesktopIcon className="h-4 w-4" aria-hidden="true" />,
	},
	{
		id: "appearance",
		label: "Appearance",
		icon: <PaintBrushIcon className="h-4 w-4" aria-hidden="true" />,
	},
	{
		id: "mcp-servers",
		label: "MCP servers",
		icon: <WrenchScrewdriverIcon className="h-4 w-4" aria-hidden="true" />,
	},
	{
		id: "skills",
		label: "Skills",
		icon: <BookOpenIcon className="h-4 w-4" aria-hidden="true" />,
	},
	{
		id: "git",
		label: "Git",
		icon: (
			<svg
				width="16"
				height="16"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
				aria-hidden="true"
			>
				<circle cx="18" cy="18" r="3" />
				<circle cx="6" cy="6" r="3" />
				<path d="M13 6h3a2 2 0 012 2v7" />
				<path d="M6 9v12" />
			</svg>
		),
	},
	{
		id: "environments",
		label: "Environments",
		icon: <CubeIcon className="h-4 w-4" aria-hidden="true" />,
	},
]

/**
 * Settings page with sidebar navigation matching desktop code-agent style.
 */
export function SettingsPage() {
	const navigate = useNavigate()
	const connected = useProviderStore((s) => s.connected)
	const popular = useProviderStore((s) => s.popular)
	const other = useProviderStore((s) => s.other)
	const [activeNav, setActiveNav] = useState<NavId>("general")

	const refreshProviders = useCallback(() => {
		apiClient
			.get<{ connected: any[]; popular: any[]; other: any[] }>("/providers")
			.then((updated) => {
				useProviderStore.getState().init(updated)
			})
			.catch((err) => console.error("[settings:refresh-providers]", err))
	}, [])

	const handleSave = useCallback(
		(providerId: string, apiKey: string, baseUrl?: string) => {
			apiClient
				.put(`/providers/${providerId}`, { apiKey, ...(baseUrl && { baseUrl }) })
				.then(refreshProviders)
				.catch((err) => console.error("[settings:save]", err))
		},
		[refreshProviders],
	)

	const handleRemoveKey = useCallback(
		(providerId: string) => {
			apiClient
				.del(`/providers/${providerId}/key`)
				.then(refreshProviders)
				.catch((err) => console.error("[settings:remove-key]", err))
		},
		[refreshProviders],
	)

	const handleBack = useCallback(() => {
		navigate({ to: "/" })
	}, [navigate])

	return (
		<div className="flex h-full">
			{/* Sidebar */}
			<aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-surface">
				{/* macOS traffic-light spacing */}
				<div
					className="h-10 shrink-0 select-none pl-[72px]"
					style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
				/>
				{/* Back button */}
				<button
					type="button"
					onClick={handleBack}
					className="mx-3 mb-4 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
				>
					<ArrowLeftIcon className="h-3.5 w-3.5" aria-hidden="true" />
					<span>Back to app</span>
				</button>
				{/* Navigation */}
				<nav className="flex flex-col gap-0.5 px-3">
					{NAV_ITEMS.map((item) => (
						<button
							key={item.id}
							type="button"
							onClick={() => setActiveNav(item.id)}
							className={cn(
								"flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
								activeNav === item.id
									? "bg-surface-hover font-medium text-foreground"
									: "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
							)}
						>
							<span className="shrink-0 text-muted">{item.icon}</span>
							<span>{item.label}</span>
						</button>
					))}
				</nav>
			</aside>

			{/* Content */}
			<main className="flex-1 overflow-y-auto">
				{/* Drag region */}
				<div
					className="h-10 shrink-0 select-none"
					style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
				/>
				<div className="mx-auto max-w-2xl px-12 pb-12">
					{activeNav === "general" && <GeneralConfig />}
					{activeNav === "providers" && (
						<>
							<h1 className="mb-6 text-xl font-semibold text-foreground">Providers</h1>
							<ProviderConfig
								connected={connected}
								popular={popular}
								other={other}
								onSave={handleSave}
								onRemoveKey={handleRemoveKey}
								onOAuthComplete={refreshProviders}
							/>
						</>
					)}
					{activeNav === "models" && <ModelsConfig />}
					{activeNav === "appearance" && <AppearanceConfig />}
					{activeNav === "mcp-servers" && <McpConfig />}
					{activeNav === "skills" && <SkillsConfig />}
					{activeNav === "git" && <PlaceholderSection title="Git" />}
					{activeNav === "environments" && <PlaceholderSection title="Environments" />}
				</div>
			</main>
		</div>
	)
}

function PlaceholderSection({ title }: { title: string }) {
	return (
		<>
			<h1 className="mb-6 text-xl font-semibold text-foreground">{title}</h1>
			<div className="rounded-xl border border-border">
				<div className="px-5 py-10 text-center text-sm text-muted">No settings available yet.</div>
			</div>
		</>
	)
}
