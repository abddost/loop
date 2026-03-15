import { useNavigate } from "@tanstack/react-router"
import { useCallback, useState } from "react"
import { GeneralConfig } from "../components/settings/general-config"
import { ProviderConfig } from "../components/settings/provider-config"
import { cn } from "../components/ui/cn"
import { apiClient } from "../lib/api-client"
import { useProviderStore } from "../stores/provider-store"

type NavId = "general" | "providers" | "personalization" | "mcp-servers" | "git" | "environments"

interface NavItem {
	id: NavId
	label: string
	icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
	{
		id: "general",
		label: "General",
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
				<circle cx="12" cy="12" r="3" />
				<path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
			</svg>
		),
	},
	{
		id: "providers",
		label: "Providers",
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
				<path d="M12 2L2 7l10 5 10-5-10-5z" />
				<path d="M2 17l10 5 10-5" />
				<path d="M2 12l10 5 10-5" />
			</svg>
		),
	},
	{
		id: "personalization",
		label: "Personalization",
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
				<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
				<circle cx="12" cy="7" r="4" />
			</svg>
		),
	},
	{
		id: "mcp-servers",
		label: "MCP servers",
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
				<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
			</svg>
		),
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
				<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
				<polyline points="3.27 6.96 12 12.01 20.73 6.96" />
				<line x1="12" y1="22.08" x2="12" y2="12" />
			</svg>
		),
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

	const handleSave = useCallback((providerId: string, apiKey: string) => {
		apiClient
			.put(`/providers/${providerId}`, { apiKey })
			.then(() => {
				apiClient
					.get<{ connected: any[]; popular: any[]; other: any[] }>("/providers")
					.then((updated) => {
						useProviderStore.getState().init(updated)
					})
			})
			.catch((err) => console.error("[settings:save]", err))
	}, [])

	const handleRemoveKey = useCallback((providerId: string) => {
		apiClient
			.del(`/providers/${providerId}/key`)
			.then(() => {
				apiClient
					.get<{ connected: any[]; popular: any[]; other: any[] }>("/providers")
					.then((updated) => {
						useProviderStore.getState().init(updated)
					})
			})
			.catch((err) => console.error("[settings:remove-key]", err))
	}, [])

	const handleBack = useCallback(() => {
		navigate({ to: "/" })
	}, [navigate])

	return (
		<div className="flex h-full">
			{/* Sidebar */}
			<aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-surface">
				{/* macOS traffic-light spacing */}
				<div className="h-8 shrink-0 select-none pl-[72px]" data-tauri-drag-region />
				{/* Back button */}
				<button
					type="button"
					onClick={handleBack}
					className="mx-3 mb-4 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
				>
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
						<path d="M19 12H5M12 19l-7-7 7-7" />
					</svg>
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
				{/* Tauri drag region */}
				<div className="h-8 shrink-0 select-none" data-tauri-drag-region />
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
							/>
						</>
					)}
					{activeNav === "personalization" && <PlaceholderSection title="Personalization" />}
					{activeNav === "mcp-servers" && <PlaceholderSection title="MCP servers" />}
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
