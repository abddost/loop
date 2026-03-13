import type { Agent } from "@core/schema/agent"
import { create } from "zustand"
import { immer } from "zustand/middleware/immer"

interface AgentState {
	agents: Agent[]
	selectedAgent: string

	init(agents: Agent[], defaultAgent: string): void
	setSelectedAgent(name: string): void
}

export const useAgentStore = create<AgentState>()(
	immer((set, get) => ({
		agents: [],
		selectedAgent: "build",

		init(agents, defaultAgent) {
			set((s) => {
				s.agents = agents
				// Use default from config, falling back to "build" if the agent doesn't exist
				const exists = agents.some((a) => a.name === defaultAgent)
				s.selectedAgent = exists ? defaultAgent : "build"
			})
		},

		setSelectedAgent(name) {
			const agents = get().agents
			const exists = agents.some((a) => a.name === name)
			if (exists) {
				set((s) => {
					s.selectedAgent = name
				})
			}
		},
	})),
)
