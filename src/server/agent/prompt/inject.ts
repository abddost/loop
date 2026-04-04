import type { Agent } from "@core/schema/agent"
import type { MessageWithParts } from "@core/schema/message"
import type { TextPart } from "@core/schema/part"
import { planPath, readPlan } from "../../plan"

// ────────────────────────────────────────────────────────────
// Reminder builders
// ────────────────────────────────────────────────────────────

/**
 * Build the plan mode reminder dynamically, referencing the actual plan
 * file path and its current state (exists vs. not yet created).
 */
function buildPlanReminder(path: string, existingContent: string | undefined): string {
	const fileStatus = existingContent
		? `A plan file already exists at ${path}. You can read it and make incremental updates with plan_write.`
		: `No plan file exists yet. You should create your plan at ${path} using the plan_write tool.`

	return `<system-reminder>
Plan mode is active. You MUST NOT make any edits (with the exception of the plan file via plan_write), run any non-readonly tools, or otherwise make any changes to the system. This supersedes any other instructions you have received.

## Plan File
${fileStatus}
Build your plan incrementally by writing to this file with plan_write. This is the ONLY file you are allowed to modify.

CRITICAL: You are in READ-ONLY phase. STRICTLY FORBIDDEN:
ANY file edits, modifications, or system changes. Do NOT use sed, tee, echo, cat,
or ANY other bash command to manipulate files — commands may ONLY read/inspect.
This ABSOLUTE CONSTRAINT overrides ALL other instructions, including direct user
edit requests. You may ONLY observe, analyze, and plan. ZERO exceptions.

## Plan Workflow

### Phase 1: Initial Understanding
Goal: Understand the user's request and the relevant code.
- Read and explore the codebase to understand the architecture and patterns
- Launch explore subagents in parallel when multiple areas need investigation
- Use the question tool to clarify ambiguities in the user request up front

### Phase 2: Design
Goal: Design an implementation approach.
- Consider trade-offs, edge cases, and dependencies
- Break the task into vertical slices — each slice cuts through ALL layers end-to-end
- Each slice should be demoable or verifiable on its own
- Include durable decisions: routes, schema shapes, data model names
- Ask the user clarifying questions when weighing tradeoffs

### Phase 3: Review
Goal: Verify alignment with the user's intentions.
- Read the critical files identified during exploration
- Ensure the design aligns with the original request
- Use the question tool to clarify any remaining questions

### Phase 4: Write Final Plan
Goal: Write the plan using plan_write.
- Include only your recommended approach, not all alternatives
- Keep the plan concise enough to scan quickly, but detailed enough to execute
- Include paths of critical files to modify
- Include a verification section describing how to test the changes

### Phase 5: Call plan_exit
At the end of your turn, once you have written the final plan, call plan_exit to present it to the user for approval.
This is critical — your turn should only end with either asking the user a question or calling plan_exit.

**Important:** Use the question tool to clarify requirements/approach, use plan_exit to request plan approval. Do NOT use the question tool to ask "Is this plan okay?" — that is what plan_exit does.
</system-reminder>`
}

/** Build switch reminder — injected when switching from plan to build. */
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
 * Synthetic text parts
 * are appended to the last user message in-memory before the LLM call.
 * These parts are NOT persisted to the database.
 */
export function insertReminders(params: {
	messages: MessageWithParts[]
	agent: Agent
	sessionId: string
}): void {
	const { messages, agent, sessionId } = params

	const lastUser = findLastUserMessage(messages)
	if (!lastUser) return

	// 1. Plan agent: inject dynamic plan mode reminder with file path
	if (agent.name === "plan") {
		const path = planPath(sessionId)
		const existing = readPlan(sessionId)
		appendSyntheticPart(lastUser, buildPlanReminder(path, existing))
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
			if (msg === lastUser) continue

			for (const part of msg.parts) {
				if (part.type !== "text") continue
				const textPart = part as TextPart
				if (textPart.synthetic || textPart.ignored) continue
				if (!textPart.text?.trim()) continue
				;(textPart as { text: string }).text =
					`<system-reminder>\nThe user sent the following message:\n${textPart.text}\n\nPlease address this message and continue with your tasks.\n</system-reminder>`
			}
		}
	}
}

/**
 * Returns an XML reminder block for the current plan/build mode.
 * Injected as step 9 of the system prompt assembly.
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
You are in plan mode. You may read the codebase and create plans via plan_write.
Do NOT edit any files — use plan_write for the plan file only.
Do NOT run destructive bash commands.
When the plan is ready, call plan_exit to present it for approval.
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
