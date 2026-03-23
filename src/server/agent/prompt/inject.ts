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

Workflow:
1. Understand the request deeply - read relevant code, search for patterns
2. Design the approach - consider trade-offs, edge cases, dependencies
3. Write a clear, actionable plan to .loop/plans/{sessionId}.md
4. Call plan_exit when the plan is ready for user approval

The plan should include:
- Summary of what needs to change
- Step-by-step implementation order
- Files that will be modified/created
- Key design decisions and rationale
- Edge cases and risks to watch for
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
				;(textPart as { text: string }).text =
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
