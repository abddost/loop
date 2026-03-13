import type { Agent } from "@core/schema/agent"
import { Select } from "../ui/select"

export interface AgentSelectorProps {
	agents: Agent[]
	selectedAgentName?: string
	onSelect: (agentName: string) => void
	className?: string
}

/**
 * Dropdown showing available primary agents.
 */
export function AgentSelector({
	agents,
	selectedAgentName,
	onSelect,
	className,
}: AgentSelectorProps) {
	const primaryAgents = agents.filter((a) => a.type === "primary")

	if (primaryAgents.length === 0) return null

	return (
		<Select
			value={selectedAgentName ?? ""}
			onChange={onSelect}
			options={primaryAgents.map((agent) => ({
				value: agent.name,
				label: agent.name.charAt(0).toUpperCase() + agent.name.slice(1),
			}))}
			className={className}
		/>
	)
}
