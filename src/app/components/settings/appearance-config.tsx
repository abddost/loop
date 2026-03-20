import { DARK_THEMES, LIGHT_THEMES, type ThemeDefinition, getTheme } from "@core/schema/theme"
import {
	CheckIcon,
	ChevronDownIcon,
	ComputerDesktopIcon,
	MoonIcon,
	SunIcon,
} from "@heroicons/react/24/outline"
import { useCallback, useRef, useState } from "react"
import { MONO_FONTS, SANS_FONTS } from "../../lib/font-loader"
import { resolveEffectiveMode } from "../../lib/theme-engine"
import { useConfigStore } from "../../stores/config-store"
import { cn } from "../ui/cn"

// ────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────

export function AppearanceConfig({ className }: { className?: string }) {
	const appearance = useConfigStore((s) => s.config.appearance)
	const resolvedMode = resolveEffectiveMode(appearance.mode)

	const updateAppearance = useCallback((patch: Record<string, unknown>) => {
		useConfigStore.getState().update({ appearance: patch })
	}, [])

	const activeThemeId = resolvedMode === "dark" ? appearance.darkTheme : appearance.lightTheme
	const themeList = resolvedMode === "dark" ? DARK_THEMES : LIGHT_THEMES
	const activeTheme = getTheme(activeThemeId)

	// Mode-specific color overrides
	const colorOverrides =
		resolvedMode === "dark" ? appearance.darkColorOverrides : appearance.lightColorOverrides

	const updateColorOverride = useCallback(
		(field: string, value: string) => {
			const key = resolvedMode === "dark" ? "darkColorOverrides" : "lightColorOverrides"
			const current =
				resolvedMode === "dark"
					? useConfigStore.getState().config.appearance.darkColorOverrides
					: useConfigStore.getState().config.appearance.lightColorOverrides
			updateAppearance({ [key]: { ...current, [field]: value } })
		},
		[resolvedMode, updateAppearance],
	)

	const clearColorOverride = useCallback(
		(field: string) => {
			const key = resolvedMode === "dark" ? "darkColorOverrides" : "lightColorOverrides"
			const current =
				resolvedMode === "dark"
					? useConfigStore.getState().config.appearance.darkColorOverrides
					: useConfigStore.getState().config.appearance.lightColorOverrides
			const { [field]: _, ...rest } = current
			updateAppearance({ [key]: rest })
		},
		[resolvedMode, updateAppearance],
	)

	return (
		<div className={className}>
			<h1 className="mb-6 text-xl font-semibold text-foreground">Appearance</h1>

			{/* Theme mode + theme selector card */}
			<div className="divide-y divide-border rounded-xl border border-border">
				<SettingRow label="Theme" description="Use light, dark, or match your system">
					<ThemeModeSegment
						value={appearance.mode}
						onChange={(mode) => updateAppearance({ mode })}
					/>
				</SettingRow>

				<SettingRow
					label={`${resolvedMode === "dark" ? "Dark" : "Light"} theme`}
					description="Choose a color theme"
				>
					<ThemeDropdown
						themes={themeList}
						value={activeThemeId}
						onChange={(id) => {
							const key = resolvedMode === "dark" ? "darkTheme" : "lightTheme"
							updateAppearance({ [key]: id })
						}}
					/>
				</SettingRow>

				<SettingRow label="Accent" description="Primary accent color">
					<ColorField
						value={colorOverrides.accent}
						placeholder={activeTheme?.colors.accent ?? "#4f8ff7"}
						onChange={(v) => updateColorOverride("accent", v)}
						onClear={() => clearColorOverride("accent")}
					/>
				</SettingRow>

				<SettingRow label="Background" description="Main background color">
					<ColorField
						value={colorOverrides.background}
						placeholder={activeTheme?.colors.background ?? "#1e1e1e"}
						onChange={(v) => updateColorOverride("background", v)}
						onClear={() => clearColorOverride("background")}
					/>
				</SettingRow>

				<SettingRow label="Foreground" description="Main text color">
					<ColorField
						value={colorOverrides.foreground}
						placeholder={activeTheme?.colors.foreground ?? "#d4d4d4"}
						onChange={(v) => updateColorOverride("foreground", v)}
						onClear={() => clearColorOverride("foreground")}
					/>
				</SettingRow>

				<SettingRow label="UI font" description="Font used for the interface">
					<FontDropdown
						fonts={SANS_FONTS}
						value={appearance.uiFont}
						onChange={(id) => updateAppearance({ uiFont: id })}
					/>
				</SettingRow>

				<SettingRow label="Code font" description="Font used for code and diffs">
					<FontDropdown
						fonts={MONO_FONTS}
						value={appearance.codeFont}
						onChange={(id) => updateAppearance({ codeFont: id })}
					/>
				</SettingRow>

				<SettingRow label="Translucent sidebar" description="Apply blur effect to the sidebar">
					<Toggle
						checked={appearance.translucentSidebar}
						onChange={(v) => updateAppearance({ translucentSidebar: v })}
					/>
				</SettingRow>

				<SettingRow label="Contrast" description="Adjust background contrast level">
					<div className="flex items-center gap-3">
						<input
							type="range"
							min={0}
							max={100}
							step={1}
							value={appearance.contrast}
							onChange={(e) => updateAppearance({ contrast: Number(e.target.value) })}
							className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-border accent-accent [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground"
						/>
						<span className="w-6 text-right text-xs tabular-nums text-muted-foreground">
							{appearance.contrast}
						</span>
					</div>
				</SettingRow>
			</div>

			{/* Font sizes */}
			<h2 className="mb-4 mt-10 text-base font-semibold text-foreground">Font sizes</h2>
			<div className="divide-y divide-border rounded-xl border border-border">
				<SettingRow label="UI font size" description="Adjust the base size used for the UI">
					<NumberInput
						value={appearance.uiFontSize}
						min={10}
						max={24}
						suffix="px"
						onChange={(v) => updateAppearance({ uiFontSize: v })}
					/>
				</SettingRow>
				<SettingRow label="Code font size" description="Adjust the base size used for code">
					<NumberInput
						value={appearance.codeFontSize}
						min={10}
						max={24}
						suffix="px"
						onChange={(v) => updateAppearance({ codeFontSize: v })}
					/>
				</SettingRow>
			</div>
		</div>
	)
}

// ────────────────────────────────────────────────────────────
// Shared components
// ────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────
// Theme mode segment (Light / Dark / System)
// ────────────────────────────────────────────────────────────

function ThemeModeSegment({
	value,
	onChange,
}: {
	value: string
	onChange: (value: "dark" | "light" | "system") => void
}) {
	const options = [
		{
			id: "light" as const,
			label: "Light",
			icon: <SunIcon className="h-3.5 w-3.5" aria-hidden="true" />,
		},
		{
			id: "dark" as const,
			label: "Dark",
			icon: <MoonIcon className="h-3.5 w-3.5" aria-hidden="true" />,
		},
		{
			id: "system" as const,
			label: "System",
			icon: <ComputerDesktopIcon className="h-3.5 w-3.5" aria-hidden="true" />,
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

// ────────────────────────────────────────────────────────────
// Theme dropdown
// ────────────────────────────────────────────────────────────

function ThemeDropdown({
	themes,
	value,
	onChange,
}: {
	themes: ThemeDefinition[]
	value: string
	onChange: (id: string) => void
}) {
	const [open, setOpen] = useState(false)
	const ref = useRef<HTMLDivElement>(null)
	const activeTheme = themes.find((t) => t.id === value)

	// Close on outside click
	const handleBlur = useCallback(() => {
		setTimeout(() => {
			if (ref.current && !ref.current.contains(document.activeElement)) {
				setOpen(false)
			}
		}, 0)
	}, [])

	return (
		<div ref={ref} className="relative" onBlur={handleBlur}>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center gap-2 rounded-lg border border-border bg-segment-bg px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover"
			>
				{activeTheme && (
					<span
						className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold"
						style={{
							backgroundColor: activeTheme.colors.accent,
							color: activeTheme.colors.accentForeground,
						}}
					>
						Aa
					</span>
				)}
				<span>{activeTheme?.name ?? "Select theme"}</span>
				<ChevronDownIcon className="h-3 w-3 text-muted" />
			</button>

			{open && (
				<div className="absolute right-0 z-50 mt-1 max-h-64 w-52 overflow-y-auto rounded-lg border border-border bg-overlay shadow-lg">
					{themes.map((theme) => (
						<button
							key={theme.id}
							type="button"
							onClick={() => {
								onChange(theme.id)
								setOpen(false)
							}}
							className={cn(
								"flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors hover:bg-surface-hover",
								value === theme.id && "bg-surface-hover",
							)}
						>
							<span
								className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold"
								style={{
									backgroundColor: theme.colors.accent,
									color: theme.colors.accentForeground,
								}}
							>
								Aa
							</span>
							<span className="flex-1 text-foreground">{theme.name}</span>
							{value === theme.id && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-accent" />}
						</button>
					))}
				</div>
			)}
		</div>
	)
}

// ────────────────────────────────────────────────────────────
// Color field (hex input + swatch)
// ────────────────────────────────────────────────────────────

function ColorField({
	value,
	placeholder,
	onChange,
	onClear,
}: {
	value: string | undefined
	placeholder: string
	onChange: (value: string) => void
	onClear: () => void
}) {
	const colorInputRef = useRef<HTMLInputElement>(null)
	const displayValue = value || placeholder
	const isOverridden = !!value

	return (
		<div className="flex items-center gap-2">
			<button
				type="button"
				onClick={() => colorInputRef.current?.click()}
				className="relative h-6 w-6 shrink-0 cursor-pointer rounded-full border border-border"
				style={{ backgroundColor: displayValue }}
			>
				<input
					ref={colorInputRef}
					type="color"
					value={displayValue}
					onChange={(e) => onChange(e.target.value)}
					className="absolute inset-0 cursor-pointer opacity-0"
					tabIndex={-1}
				/>
			</button>
			<div
				className={cn(
					"flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-mono",
					isOverridden
						? "border-accent/40 bg-accent/10 text-foreground"
						: "border-border bg-segment-bg text-muted-foreground",
				)}
			>
				<span className="uppercase">{displayValue}</span>
				{isOverridden && (
					<button
						type="button"
						onClick={onClear}
						className="ml-1 text-muted-foreground hover:text-foreground"
						title="Reset to theme default"
					>
						&times;
					</button>
				)}
			</div>
		</div>
	)
}

// ────────────────────────────────────────────────────────────
// Font dropdown
// ────────────────────────────────────────────────────────────

function FontDropdown({
	fonts,
	value,
	onChange,
}: {
	fonts: { id: string; name: string }[]
	value: string | null
	onChange: (id: string | null) => void
}) {
	const [open, setOpen] = useState(false)
	const ref = useRef<HTMLDivElement>(null)
	const activeFont = fonts.find((f) => f.id === value) ?? fonts[0]

	const handleBlur = useCallback(() => {
		setTimeout(() => {
			if (ref.current && !ref.current.contains(document.activeElement)) {
				setOpen(false)
			}
		}, 0)
	}, [])

	return (
		<div ref={ref} className="relative" onBlur={handleBlur}>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center gap-2 rounded-lg border border-border bg-segment-bg px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-hover"
			>
				<span>{activeFont?.name ?? "System Default"}</span>
				<ChevronDownIcon className="h-3 w-3 text-muted" />
			</button>

			{open && (
				<div className="absolute right-0 z-50 mt-1 max-h-64 w-48 overflow-y-auto rounded-lg border border-border bg-overlay shadow-lg">
					{fonts.map((font) => (
						<button
							key={font.id}
							type="button"
							onClick={() => {
								onChange(font.id === "system" || font.id === "system-mono" ? null : font.id)
								setOpen(false)
							}}
							className={cn(
								"flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-surface-hover",
								(value === font.id ||
									(!value && (font.id === "system" || font.id === "system-mono"))) &&
									"bg-surface-hover",
							)}
						>
							<span className="text-foreground">{font.name}</span>
							{(value === font.id ||
								(!value && (font.id === "system" || font.id === "system-mono"))) && (
								<CheckIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
							)}
						</button>
					))}
				</div>
			)}
		</div>
	)
}

// ────────────────────────────────────────────────────────────
// Toggle switch
// ────────────────────────────────────────────────────────────

function Toggle({
	checked,
	onChange,
}: {
	checked: boolean
	onChange: (value: boolean) => void
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			onClick={() => onChange(!checked)}
			className={cn(
				"relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
				checked ? "bg-accent" : "bg-border",
			)}
		>
			<span
				className={cn(
					"inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
					checked ? "translate-x-[18px]" : "translate-x-[3px]",
				)}
			/>
		</button>
	)
}

// ────────────────────────────────────────────────────────────
// Number input with suffix
// ────────────────────────────────────────────────────────────

function NumberInput({
	value,
	min,
	max,
	suffix,
	onChange,
}: {
	value: number
	min: number
	max: number
	suffix: string
	onChange: (value: number) => void
}) {
	return (
		<div className="flex items-center gap-1.5">
			<input
				type="number"
				value={value}
				min={min}
				max={max}
				onChange={(e) => {
					const n = Number(e.target.value)
					if (!Number.isNaN(n) && n >= min && n <= max) onChange(n)
				}}
				className="w-14 rounded-lg border border-border bg-segment-bg px-2.5 py-1 text-center text-xs tabular-nums text-foreground outline-none focus:border-accent"
			/>
			<span className="text-xs text-muted-foreground">{suffix}</span>
		</div>
	)
}
