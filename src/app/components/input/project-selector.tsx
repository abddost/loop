import type { Project } from "@core/schema"
import { Select } from "../ui/select"

export interface ProjectSelectorProps {
	projects: Project[]
	selectedProjectId: string | null
	onSelect: (projectId: string) => void
}

/**
 * Inline project selector for the new-session hero.
 */
export function ProjectSelector({ projects, selectedProjectId, onSelect }: ProjectSelectorProps) {
	return (
		<Select
			value={selectedProjectId ?? ""}
			onChange={(value) => {
				if (value) onSelect(value)
			}}
			options={projects.map((p) => ({ value: p.id, label: p.name }))}
			placeholder="Select your project"
			className="mx-auto mt-2 min-w-[180px] text-center text-lg font-medium"
		/>
	)
}
