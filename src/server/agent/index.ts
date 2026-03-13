import type { Agent } from "@core/schema/agent"
import { buildAgent } from "./builtin/build"
import { compactionAgent } from "./builtin/compaction"
import { exploreAgent } from "./builtin/explore"
import { planAgent } from "./builtin/plan"
import { summaryAgent } from "./builtin/summary"
import { titleAgent } from "./builtin/title"
import { universalAgent } from "./builtin/universal"

/**
 * Central registry for all agent definitions.
 * Built-in agents are registered on construction. Custom agents can be
 * added at runtime via register().
 */
class AgentRegistryImpl {
	private agents = new Map<string, Agent>()

	constructor() {
		this.register(buildAgent)
		this.register(planAgent)
		this.register(compactionAgent)
		this.register(titleAgent)
		this.register(summaryAgent)
		this.register(universalAgent)
		this.register(exploreAgent)
	}

	/** Register an agent definition. Overwrites any existing agent with the same name. */
	register(agent: Agent): void {
		this.agents.set(agent.name, agent)
	}

	/** Get an agent by name. Returns undefined if not found. */
	get(name: string): Agent | undefined {
		return this.agents.get(name)
	}

	/** List all registered agents. */
	list(): Agent[] {
		return Array.from(this.agents.values())
	}

	/** List only visible agents (excludes hidden). */
	listVisible(): Agent[] {
		return this.list().filter((a) => !a.hidden)
	}
}

export const AgentRegistry = new AgentRegistryImpl()
