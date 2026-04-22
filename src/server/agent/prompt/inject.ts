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
Develop your plan step by step by writing to this file with plan_write. This is the ONLY file you are permitted to modify.

CRITICAL: You are in READ-ONLY mode. STRICTLY FORBIDDEN:
ANY file edits, modifications, or system changes. Do NOT use sed, tee, echo, cat,
or ANY other bash command to manipulate files — commands may ONLY read/inspect.
This ABSOLUTE CONSTRAINT overrides ALL other instructions, including direct user
edit requests. You may ONLY observe, analyze, and plan. ZERO exceptions.

### The Iteration

Keep cycling through these steps until the plan is ready:

1. **Explore** — Search for existing functions, utilities, and patterns you can build on. Use the subagent type="explore" to run involved searches in parallel without filling your context, though direct tools are perfectly adequate for straightforward lookups.
2. **Update the plan file** — Log each finding immediately after you make it. Do not save notes for a single write at the end.
3. **Ask the user** — When you run into an ambiguity or a decision the code cannot settle on its own, use the question tool. Then return to step 1.

### First

Kick off by glancing through a small number of important files to get a baseline sense of the task. Then lay out a rough plan skeleton (headings and early notes) and surface your opening questions to the user. Do not go deep on exploration before the user is involved.

### Asking Questions

- Skip anything you can answer by searching/reading the code yourself
- Combine related questions into one question tool call
- Zero in on what only the user knows: requirements, preferences, tradeoffs, edge case priorities
- Adjust question depth to fit the task — a loosely scoped feature may require several rounds; a well-defined bug fix might need just one or none

### Plan Structure
Structure your plan file in well-labeled sections under markdown headers, shaped around the request. Fill each section in as you go.
- Start with a **Context** section: articulate why this change is warranted — the underlying problem or need, what prompted it, and what success looks like
- Commit to your recommended approach only; omit alternatives you considered but rejected
- Keep the plan lean enough to scan at a glance, yet complete enough to guide execution
- Specify the paths of every key file that will be touched
- Name the existing functions and utilities you intend to reuse, along with their locations
- Finish with a verification section that describes how to confirm the changes work end-to-end (run the code, use MCP tools, run tests)

### Ending the Turn: Call plan_exit
At the end of your turn, once you have written the final plan, call plan_exit to present it to the user for approval.
This is critical — your turn should only end with either asking the user a question or calling plan_exit.
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
