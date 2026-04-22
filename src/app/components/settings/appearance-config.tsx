import { DARK_THEMES, LIGHT_THEMES, type ThemeDefinition, getTheme } from "@core/schema/theme"
import { Check, ChevronDown, Desktop, Moon, Sun } from "@openai/apps-sdk-ui/components/Icon"
import { useCallback, useEffect, useRef, useState } from "react"
import { MONO_FONTS, SANS_FONTS } from "../../lib/font-loader"
import { resolveEffectiveMode } from "../../lib/theme-engine"
import { useConfigStore } from "../../stores/config-store"
import { cn } from "../ui/cn"
import { Tooltip } from "../ui/tooltip"
import { ToggleSwitch } from "./shared"

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

			<div className="bg-overlay shadow-[var(--shadow-outline)] rounded-xl py-2 px-1 divide-y divide-[var(--separator)] overflow-hidden">
				<div className="px-5 py-4 pt-3">
					<div className="flex items-center justify-between gap-6 mb-2">
						<div className="min-w-0">
							<div className="text-sm font-medium text-foreground">Theme</div>
							<div className="mt-0.5 text-xs text-muted">Use light, dark, or match your system</div>
						</div>
						<div className="shrink-0 flex items-center gap-1">
							{(["light", "dark", "system"] as const).map((m) => {
								const Icon = m === "light" ? Sun : m === "dark" ? Moon : Desktop
								const active = appearance.mode === m
								return (
									<button
										key={m}
										type="button"
										onClick={() => updateAppearance({ mode: m })}
										className={cn(
											"flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs capitalize transition-colors",
											active
												? "bg-surface text-foreground font-medium shadow-[var(--shadow-inset)]"
												: "text-muted-foreground hover:text-foreground",
										)}
									>
										<Icon className="w-4 h-4" />
										{m}
									</button>
								)
							})}
						</div>
					</div>
				</div>

				<SettingRow label={`${resolvedMode === "dark" ? "Dark" : "Light"} theme`}>
					<ThemeDropdown
						themes={themeList}
						value={activeThemeId}
						onChange={(id) => {
							const key = resolvedMode === "dark" ? "darkTheme" : "lightTheme"
							const overrideKey =
								resolvedMode === "dark" ? "darkColorOverrides" : "lightColorOverrides"
							updateAppearance({ [key]: id, [overrideKey]: {} })
						}}
					/>
				</SettingRow>

				<SettingRow label="Accent">
					<ColorField
						value={colorOverrides.accent}
						placeholder={activeTheme?.colors.accent ?? "#4f8ff7"}
						onChange={(v) => updateColorOverride("accent", v)}
						onClear={() => clearColorOverride("accent")}
					/>
				</SettingRow>

				<SettingRow label="Background">
					<ColorField
						value={colorOverrides.background}
						placeholder={activeTheme?.colors.background ?? "#1e1e1e"}
						onChange={(v) => updateColorOverride("background", v)}
						onClear={() => clearColorOverride("background")}
					/>
				</SettingRow>

				<SettingRow label="Foreground">
					<ColorField
						value={colorOverrides.foreground}
						placeholder={activeTheme?.colors.foreground ?? "#d4d4d4"}
						onChange={(v) => updateColorOverride("foreground", v)}
						onClear={() => clearColorOverride("foreground")}
					/>
				</SettingRow>

				<SettingRow label="Welcome glow">
					<ColorField
						value={colorOverrides.appWelcomeGlow}
						placeholder={activeTheme?.colors.appWelcomeGlow ?? "#34d399"}
						onChange={(v) => updateColorOverride("appWelcomeGlow", v)}
						onClear={() => clearColorOverride("appWelcomeGlow")}
					/>
				</SettingRow>

				<SettingRow label="UI font">
					<FontDropdown
						fonts={SANS_FONTS}
						value={appearance.uiFont}
						onChange={(id) => updateAppearance({ uiFont: id })}
					/>
				</SettingRow>

				<SettingRow label="Code font">
					<FontDropdown
						fonts={MONO_FONTS}
						value={appearance.codeFont}
						onChange={(id) => updateAppearance({ codeFont: id })}
					/>
				</SettingRow>

				<SettingRow label="Translucent mode">
					<ToggleSwitch
						checked={appearance.glassMode}
						onChange={() => updateAppearance({ glassMode: !appearance.glassMode })}
					/>
				</SettingRow>

				<SettingRow label="Contrast">
					<div className="flex items-center gap-3">
						<input
							type="range"
							min={0}
							max={100}
							step={1}
							value={appearance.contrast}
							onChange={(e) => updateAppearance({ contrast: Number(e.target.value) })}
							className="h-1.5 w-[140px] cursor-pointer appearance-none rounded-full bg-border accent-foreground [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-md"
						/>
						<span className="w-6 text-right text-xs tabular-nums text-foreground font-medium">
							{appearance.contrast}
						</span>
					</div>
				</SettingRow>
			</div>

			<div className="bg-overlay shadow-[var(--shadow-outline)] rounded-xl py-2 px-1 divide-y divide-[var(--separator)] mt-6">
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
	description?: string
	children: React.ReactNode
}) {
	return (
		<div className="flex items-center justify-between gap-6 px-5 py-[14px]">
			<div className="min-w-0">
				<div className="text-[13px] font-medium text-foreground">{label}</div>
				{description && <div className="mt-1 text-xs text-muted">{description}</div>}
			</div>
			<div className="shrink-0">{children}</div>
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
		<div ref={ref} className="relative inline-block" onBlur={handleBlur}>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center gap-2 rounded-lg border border-[var(--separator)] bg-surface px-[10px] py-[5px] text-[12px] font-medium text-foreground transition-colors min-w-[120px] justify-between shadow-[var(--shadow-inset)]"
			>
				<div className="flex items-center gap-2">
					{activeTheme && (
						<span
							className="flex h-5 w-5 rounded-[4px] items-center justify-center text-[9px] font-bold shadow-[var(--shadow-card)]"
							style={{
								backgroundColor: activeTheme.colors.accent,
								color: activeTheme.colors.accentForeground,
							}}
						>
							Aa
						</span>
					)}
					<span>{activeTheme?.name ?? "Select theme"}</span>
				</div>
				<ChevronDown className="h-[14px] w-[14px] text-muted-foreground ml-1" />
			</button>

			{open && (
				<div className="el-dropdown absolute right-0 z-50 mt-1 max-h-64 w-48 overflow-y-auto rounded-lg">
					{themes.map((theme) => (
						<button
							key={theme.id}
							type="button"
							onClick={() => {
								onChange(theme.id)
								setOpen(false)
							}}
							className={cn(
								"flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors hover:bg-surface-hover",
								value === theme.id && "bg-surface-hover",
							)}
						>
							<span
								className="flex h-5 w-5 shrink-0 rounded-[4px] items-center justify-center text-[9px] font-bold shadow-[var(--shadow-card)]"
								style={{
									backgroundColor: theme.colors.accent,
									color: theme.colors.accentForeground,
								}}
							>
								Aa
							</span>
							<span className="flex-1 text-foreground truncate">{theme.name}</span>
							{value === theme.id && <Check className="h-4 w-4 shrink-0 text-foreground" />}
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
			<div
				className={cn(
					"flex items-center gap-3 rounded-lg border px-[6px] py-[4px] text-[12px] bg-surface shadow-[var(--shadow-inset)]",
					isOverridden
						? "border-[var(--separator)] text-foreground"
						: "border-[var(--separator)] text-foreground",
				)}
			>
				<button
					type="button"
					onClick={() => colorInputRef.current?.click()}
					className="relative h-[18px] w-[32px] shrink-0 cursor-pointer rounded overflow-hidden flex items-center justify-center"
				>
					<div className="absolute inset-0 ring-1 ring-inset ring-[rgba(255,255,255,0.1)] pointer-events-none rounded z-10 box-border" />
					<input
						ref={colorInputRef}
						type="color"
						value={displayValue}
						onChange={(e) => onChange(e.target.value)}
						className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[200%] h-[200%] cursor-pointer m-0 p-0 border-0 outline-none block z-0 appearance-none bg-transparent"
						tabIndex={-1}
					/>
				</button>

				<span className="font-mono uppercase min-w-[7ch] text-center text-muted-foreground mr-1">
					{displayValue}
				</span>
				{isOverridden && (
					<Tooltip content="Reset to theme default">
						<button
							type="button"
							onClick={onClear}
							className="text-muted-foreground hover:text-foreground mr-1"
						>
							&times;
						</button>
					</Tooltip>
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
		<div ref={ref} className="relative inline-block" onBlur={handleBlur}>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center rounded-lg border border-[var(--separator)] bg-surface px-3 py-[6px] text-xs font-medium text-muted-foreground hover:text-foreground transition-colors min-w-[160px] justify-between shadow-[var(--shadow-inset)]"
			>
				<span className="truncate">{activeFont?.name ?? "System Default"}</span>
				<ChevronDown className="h-[14px] w-[14px] shrink-0 ml-2" />
			</button>

			{open && (
				<div className="el-dropdown absolute right-0 z-50 mt-1 max-h-64 w-48 overflow-y-auto rounded-lg">
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
							<span className="text-foreground truncate">{font.name}</span>
							{(value === font.id ||
								(!value && (font.id === "system" || font.id === "system-mono"))) && (
								<Check className="h-3.5 w-3.5 shrink-0 text-foreground" />
							)}
						</button>
					))}
				</div>
			)}
		</div>
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
	const [raw, setRaw] = useState(String(value))

	useEffect(() => {
		setRaw(String(value))
	}, [value])

	const commit = (str: string) => {
		const n = Number.parseInt(str, 10)
		if (!Number.isNaN(n)) {
			const clamped = Math.min(max, Math.max(min, n))
			onChange(clamped)
			setRaw(String(clamped))
		} else {
			setRaw(String(value))
		}
	}

	return (
		<div className="flex items-center gap-1.5 focus-within:ring-1 focus-within:ring-border rounded-lg bg-surface shadow-[var(--shadow-inset)] pr-3 border border-[var(--separator)]">
			<input
				type="number"
				value={raw}
				min={min}
				max={max}
				onChange={(e) => setRaw(e.target.value)}
				onBlur={(e) => commit(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === "Enter") commit((e.target as HTMLInputElement).value)
				}}
				className="bg-transparent px-2 py-[6px] text-center text-xs tabular-nums text-foreground outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
				style={{ width: 36 }}
			/>
			<span className="text-[12px] text-muted-foreground">{suffix}</span>
		</div>
	)
}
