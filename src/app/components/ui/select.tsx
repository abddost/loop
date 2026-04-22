import { Header, Select as HeroSelect, ListBox } from "@heroui/react"
import type { Key } from "react"

export interface SelectOption {
	value: string
	label: string
	disabled?: boolean
}

export interface SelectGroup {
	label: string
	options: SelectOption[]
}

export interface SelectProps {
	value: string
	onChange: (value: string) => void
	options?: SelectOption[]
	groups?: SelectGroup[]
	placeholder?: string
	className?: string
	label?: string
}

/**
 * Data-driven select wrapper over HeroUI Select.
 * Accepts flat options or grouped options and provides a simple value/onChange API.
 */
export function Select({
	value,
	onChange,
	options,
	groups,
	placeholder,
	className,
	label,
}: SelectProps) {
	const handleChange = (key: Key | null) => {
		if (key != null) onChange(String(key))
	}

	return (
		<HeroSelect
			selectedKey={value || null}
			onSelectionChange={handleChange}
			placeholder={placeholder}
			aria-label={label ?? placeholder ?? "Select"}
			className={className}
		>
			<HeroSelect.Trigger className="!border-none !shadow-[var(--shadow-inset)] !rounded-lg !bg-[var(--default)]">
				<HeroSelect.Value />
				<HeroSelect.Indicator />
			</HeroSelect.Trigger>
			<HeroSelect.Popover className="el-dropdown !border-none">
				<ListBox>
					{(options ?? []).map((opt) => (
						<ListBox.Item
							key={opt.value}
							id={opt.value}
							textValue={opt.label}
							isDisabled={opt.disabled}
							className="rounded-md transition-colors hover:bg-[var(--app-surface-hover)]"
						>
							{opt.label}
						</ListBox.Item>
					))}
					{(groups ?? []).map((group) => (
						<ListBox.Section key={group.label}>
							<Header>{group.label}</Header>
							{group.options.map((opt) => (
								<ListBox.Item
									key={opt.value}
									id={opt.value}
									textValue={opt.label}
									className="rounded-md transition-colors hover:bg-[var(--app-surface-hover)]"
								>
									{opt.label}
								</ListBox.Item>
							))}
						</ListBox.Section>
					))}
				</ListBox>
			</HeroSelect.Popover>
		</HeroSelect>
	)
}
