import {
	Archive,
	BackSmall,
	BookOpen,
	Desktop,
	KeyboardShortcut,
	LightMode,
	SettingsCog,
	SettingsWrench,
	Stack,
} from "@openai/apps-sdk-ui/components/Icon"
import { useNavigate } from "@tanstack/react-router"
import { useCallback, useState } from "react"
import { AppearanceConfig } from "../components/settings/appearance-config"
import { ArchivedSessionsConfig } from "../components/settings/archived-sessions-config"
import { ClaudeCodeConfig } from "../components/settings/claude-code-config"
import { GeneralConfig } from "../components/settings/general-config"
import { KeybindingConfig } from "../components/settings/keybinding-config"
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
	| "keyboard"
	| "mcp-servers"
	| "skills"
	| "archived"

interface NavItem {
	id: NavId
	label: string
	icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
	{
		id: "general",
		label: "General",
		icon: <SettingsCog className="h-4 w-4" aria-hidden="true" />,
	},
	{
		id: "providers",
		label: "Providers",
		icon: <Stack className="h-4 w-4" aria-hidden="true" />,
	},
	{
		id: "models",
		label: "Models",
		icon: <Desktop className="h-4 w-4" aria-hidden="true" />,
	},
	{
		id: "appearance",
		label: "Appearance",
		icon: <LightMode className="h-4 w-4" aria-hidden="true" />,
	},
	{
		id: "keyboard",
		label: "Keyboard Shortcuts",
		icon: <KeyboardShortcut className="h-4 w-4" aria-hidden="true" />,
	},
	{
		id: "mcp-servers",
		label: "MCP servers",
		icon: <SettingsWrench className="h-4 w-4" aria-hidden="true" />,
	},
	{
		id: "skills",
		label: "Skills",
		icon: <BookOpen className="h-4 w-4" aria-hidden="true" />,
	},
	{
		id: "archived",
		label: "Archived",
		icon: <Archive className="h-4 w-4" aria-hidden="true" />,
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

	const handleBack = useCallback(() => {
		navigate({ to: "/" })
	}, [navigate])

	return (
		<div className="flex h-full w-full">
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
					<BackSmall className="h-3.5 w-3.5" aria-hidden="true" />
					<span>Back</span>
				</button>
				{/* Navigation */}
				<nav className="flex flex-col gap-0.5 px-3">
					{NAV_ITEMS.map((item) => (
						<button
							key={item.id}
							type="button"
							onClick={() => setActiveNav(item.id)}
							className={cn(
								"el-tab flex items-center gap-3 px-3 py-2 text-sm",
								activeNav === item.id
									? "bg-surface-hover font-medium text-foreground"
									: "text-muted-foreground",
							)}
						>
							<span className="shrink-0 text-muted">{item.icon}</span>
							<span>{item.label}</span>
						</button>
					))}
				</nav>
			</aside>

			{/* Content */}
			<main className="flex flex-1 flex-col overflow-y-auto bg-background">
				{/* Drag region */}
				<div
					className="h-10 shrink-0 select-none"
					style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
				/>
				<div className="flex flex-1 justify-center px-10 pb-12">
					<div className="w-full max-w-2xl">
						{activeNav === "general" && <GeneralConfig />}
						{activeNav === "providers" && (
							<>
								<h1 className="mb-6 text-xl font-semibold text-foreground">Providers</h1>
								<ClaudeCodeConfig className="mb-10" />
								<ProviderConfig
									connected={connected}
									popular={popular}
									other={other}
									onRefresh={refreshProviders}
								/>
							</>
						)}
						{activeNav === "models" && <ModelsConfig />}
						{activeNav === "appearance" && <AppearanceConfig />}
						{activeNav === "keyboard" && <KeybindingConfig />}
						{activeNav === "mcp-servers" && <McpConfig />}
						{activeNav === "skills" && <SkillsConfig />}
						{activeNav === "archived" && <ArchivedSessionsConfig />}
					</div>
				</div>
			</main>
		</div>
	)
}
