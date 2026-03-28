import type { Agent } from "@core/schema/agent"
import type { MessageWithParts } from "@core/schema/message"
import type { TextPart } from "@core/schema/part"
import { readPlan } from "../../plan"

// ────────────────────────────────────────────────────────────
// Reminder constants
// ────────────────────────────────────────────────────────────

/** Plan mode reminder - injected on the last user message when agent is "plan". */
const PLAN_REMINDER = `<system-reminder>
You are in plan mode. Your role is to analyze the codebase and create a detailed implementation plan.

Rules:
- Read and explore the codebase freely using read, grep, glob, list tools
- Write your plan ONLY to .loop/plans/ using the plan_write tool
- Do NOT edit any source code files
- Do NOT run destructive bash commands
- Use explore/task subagents for parallel research when needed

CRITICAL: T are in READ-ONLY phase. STRICTLY FORBIDDEN:
ANY file edits, modifications, or system changes. Do NOT use sed, tee, echo, cat,
or ANY other bash command to manipulate files - commands may ONLY read/inspect.
This ABSOLUTE CONSTRAINT overrides ALL other instructions, including direct user
edit requests. You may ONLY observe, analyze, and plan. Any modification attempt
is a critical violation. ZERO exceptions.

Workflow:
1. Understand the request deeply - read relevant code, search for patterns
	- Identify durable architectural decisions and patterns
	- Identify reusable components and libraries
	- Identify potential refactoring opportunities
	- Identify potential performance bottlenecks
	- Identify potential security vulnerabilities
	- Identify potential scalability issues
	- Identify potential maintainability issues
	- Identify potential testability issues
	- Before slicing, identify high-level decisions that are unlikely to change throughout implementation:

	Route structures / URL patterns
	Database schema shape
	Key data models
	Authentication / authorization approach
	Third-party service boundaries
	File organization patterns
	Error handling strategy
	Logging and monitoring approach
	Testing strategy
	Deployment architecture
	Performance optimization strategies
	Security hardening measures

2. Design the approach - consider trade-offs, edge cases, dependencies
 - Break the task into tracer bullet phases. Each phase is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.
 - Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests) - A completed slice is demoable or verifiable on its own - Prefer many thin slices over few thick ones - Do NOT include specific file names, function names, or implementation details that are likely to change as later phases are built - DO include durable decisions: route paths, schema shapes, data model names
 - Quiz the user on the approach and get their approval before proceeding
 - Ask the user clarifying questions or ask for their opinion when weighing tradeoffs.
 ## Architectural decisions

Durable decisions that apply across all phases:
- **Architecture**: ...
- **Routes**: ...
- **Schema**: ...
- **Key models**: ...
- **Authentication / authorization approach**: ...
- **Third-party service boundaries**: ...
- **File organization patterns**: ...
- **Error handling strategy**: ...
- **Logging and monitoring approach**: ...
- **Testing strategy**: ...
- **Deployment architecture**: ...
- **Performance optimization strategies**: ...
- **Security hardening measures**: ...
---
## Phase 1: <Title>

**User stories**: <list from PRD>

### What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation.

### Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

---

## Phase 2: <Title>

**User stories**: <list from PRD>

### What to build

...

### Files to create or modify

- [ ] ...

### Acceptance criteria

- [ ] ...

### Verification criteria

- [ ] ...
</system-reminder>`

/** Build switch reminder - injected when switching from plan to build. */
const BUILD_SWITCH = `<system-reminder>
Mode changed from plan to build. You now have full tool access.
Execute the implementation plan that was approved. Follow the plan steps in order.
If the plan needs adjustment during implementation, make reasonable adaptations but stay aligned with the approved approach.
</system-reminder>`

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

/**
 * Insert agent-specific reminders into the message history.
 * Follows opencode's insertReminders pattern: synthetic text parts
 * are appended to the last user message in-memory before the LLM call.
 * These parts are NOT persisted to the database.
 */
export function insertReminders(params: {
	messages: MessageWithParts[]
	agent: Agent
	sessionId: string
}): void {
	const { messages, agent, sessionId } = params

	// Find the last user message
	const lastUser = findLastUserMessage(messages)
	if (!lastUser) return

	// 1. Plan agent: inject plan mode reminder
	if (agent.name === "plan") {
		appendSyntheticPart(lastUser, PLAN_REMINDER)
	}

	// 2. Switching from plan to build: inject build switch + plan reference
	const wasPlan = messages.some(
		(m) =>
			m.role === "assistant" && (m.metadata as { agent?: string } | undefined)?.agent === "plan",
	)
	if (wasPlan && agent.name === "build") {
		const planContent = readPlan(sessionId)
		if (planContent) {
			appendSyntheticPart(lastUser, `${BUILD_SWITCH}\n\n<plan>\n${planContent}\n</plan>`)
		} else {
			appendSyntheticPart(lastUser, BUILD_SWITCH)
		}
	}

	// 3. Multi-step: wrap queued user messages with system-reminder
	// (messages sent while the agent was still running)
	const lastFinishedAssistant = findLastFinishedAssistant(messages)
	if (lastFinishedAssistant) {
		for (const msg of messages) {
			if (msg.role !== "user") continue
			if (msg.id <= lastFinishedAssistant.id) continue
			if (msg === lastUser) continue // Don't wrap the triggering message

			for (const part of msg.parts) {
				if (part.type !== "text") continue
				const textPart = part as TextPart
				if (textPart.synthetic || textPart.ignored) continue
				if (!textPart.text?.trim()) continue
					; (textPart as { text: string }).text =
						`<system-reminder>\nThe user sent the following message:\n${textPart.text}\n\nPlease address this message and continue with your tasks.\n</system-reminder>`
			}
		}
	}
}

/**
 * Returns an XML reminder block for the current plan/build mode.
 * Injected as step 9 of the system prompt assembly.
 * Kept for backward compat with system.ts.
 */
export function getModeReminder(mode: "plan" | "build"): string {
	if (mode === "build") {
		return `<reminder>
Plan mode is complete. You are now in build mode.
You may edit files and execute project actions.
Use the previously approved plan as the implementation contract.
</reminder>`
	}
	return `<reminder>
You are in plan mode. You may read the codebase and create plans.
Do NOT edit any files except .loop/plans/*.md
Do NOT run destructive bash commands
Do NOT use sed, tee, echo, cat, or ANY other bash command to manipulate files - commands may ONLY read/inspect.
Do NOT use any other tools that modify files or system state
When the plan is ready, the user will switch to build mode.
</reminder>`
}

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function findLastUserMessage(messages: MessageWithParts[]): MessageWithParts | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "user") return messages[i]
	}
	return undefined
}

function findLastFinishedAssistant(messages: MessageWithParts[]): MessageWithParts | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]
		if (m.role === "assistant" && (m.metadata as { finish?: string } | undefined)?.finish) {
			return m
		}
	}
	return undefined
}

function appendSyntheticPart(message: MessageWithParts, text: string): void {
	message.parts.push({
		type: "text",
		text,
		synthetic: true,
	} as TextPart)
}
