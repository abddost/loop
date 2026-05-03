import { Header, Select as HeroSelect, ListBox } from "@heroui/react"
import { ChevronDown } from "@openai/apps-sdk-ui/components/Icon"
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

	const selectedLabel =
		options?.find((opt) => opt.value === value)?.label ??
		groups?.flatMap((group) => group.options).find((opt) => opt.value === value)?.label

	return (
		<HeroSelect
			selectedKey={value || null}
			onSelectionChange={handleChange}
			placeholder={placeholder}
			aria-label={label ?? placeholder ?? "Select"}
			className={className}
		>
			<HeroSelect.Trigger className="flex! h-9! min-h-9! items-center! justify-between! rounded-lg! border-none! bg-default! px-3! text-sm! leading-none! shadow-(--shadow-inset)!">
				<span className="min-w-0 flex-1 truncate text-left text-sm leading-5 text-foreground">
					{selectedLabel ?? placeholder}
				</span>
				<ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
			</HeroSelect.Trigger>
			<HeroSelect.Popover className="el-dropdown border-none! p-1">
				<ListBox className="space-y-0.5">
					{(options ?? []).map((opt) => (
						<ListBox.Item
							key={opt.value}
							id={opt.value}
							textValue={opt.label}
							isDisabled={opt.disabled}
							className="rounded-md px-2.5 py-1.5 text-sm leading-5 transition-colors hover:bg-(--app-surface-hover)"
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
									className="rounded-md px-2.5 py-1.5 text-sm leading-5 transition-colors hover:bg-(--app-surface-hover)"
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
