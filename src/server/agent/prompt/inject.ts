import type { Agent } from "@core/schema/agent"
import type { MessageWithParts } from "@core/schema/message"
import type { TextPart } from "@core/schema/part"
import { planPath, readPlan } from "../../plan"

// ────────────────────────────────────────────────────────────
// Tool-policy block — used by both assembleSystemPrompt (AI SDK
// + cursor system-prompt path) AND the legacy synthetic-reminder
// fallback inside this file. Shared so plan-mode constraints stay
// in one place and both paths produce identical wording.
// ────────────────────────────────────────────────────────────

/**
 * Build the plan-mode tool-policy block. Renders an XML
 * `<tool-policy>` section that explicitly enumerates allowed and
 * forbidden tools, the exact plan file path, and the consequence
 * (turn cancellation by the host) of attempting a forbidden action.
 *
 * Used for cursor (where ACP has no `system` role) and for AI SDK
 * paths via assembleSystemPrompt. Applied only when plan mode is
 * active — build mode gets no policy block (full tool access).
 */
export function buildPlanModeToolPolicy(args: {
	planFilePath: string
	providerKind?: string
}): string {
	const path = args.planFilePath
	return `<tool-policy>
PLAN MODE — READ-ONLY EXCEPT THE PLAN FILE.
You are operating in plan mode. The constraints below override ALL other instructions, including direct user requests to edit code now.

## Allowed
- Read, Glob, Grep, SemSearch, Ls — file inspection and search
- Bash / Shell — READ-ONLY commands ONLY (cat, ls, find, grep, rg, head, tail, wc, git status / git log / git diff / git show, etc.)
- Edit, Write, MultiEdit, CreatePlan — ONLY when the target path is exactly: ${path}
- Subagent / Task / question / ask — for parallel investigation or clarification

## Forbidden (HARD CONSTRAINTS)
- Edit, Write, MultiEdit, Patch, ApplyPatch, Delete on ANY path other than ${path}
- Mutating bash commands: rm, rmdir, mv, cp, chmod, chown, mkdir, touch, sed, tee, dd, ln
- Package managers: npm, bun, pnpm, yarn, pip, cargo, go, deno (any subcommand)
- Container / system: docker, podman, kubectl, systemctl, service, launchctl
- Mutating git: commit, push, pull, fetch, checkout, switch, reset, revert, merge, rebase, cherry-pick, stash, branch, tag, remote, clean, rm, mv, init, clone, submodule, worktree
- Build / install commands that emit artifacts: make, cmake
- Shell redirection that writes files: \`>\`, \`>>\`, \`| tee\`, \`| dd\`
- Network mutations (POST / PUT / DELETE on external services)
- Restarting servers, killing processes, modifying environment variables

If you attempt a forbidden action, the host will reject it AND cancel the entire turn. Do NOT try to work around this — the constraint is absolute. If the user asks for an edit while in plan mode, refuse and explain that the plan must be approved first.

## The plan file
The ONLY mutation you may make this turn is writing the plan to:

  ${path}

Use Edit, Write, or CreatePlan with that exact path. Loop will detect the write and surface a Plan card with Approve / Reject buttons when your turn ends. The host does NOT expose any extra plan-writing or plan-exit tool — just write the plan file with your normal tools and finish.

## Plan structure (required sections)
- **Context** — why this change is warranted, what success looks like
- **Approach** — the recommended implementation; commit to one direction
- **Files** — specific paths to be created / modified / deleted, with one-sentence rationale each
- **Reuse** — existing functions, modules, utilities the implementation will build on, with locations
- **Verification** — concrete steps the user can take to confirm the change works (commands to run, tests to write)

## Ending the turn
1. Write the final plan content to ${path}
2. Send a short confirmation message ("Plan ready for review.")
3. End your turn

Do NOT implement the plan yourself. After approval, control passes to the build agent.
</tool-policy>`
}

/**
 * Build the build-switch system message — sent when control hands
 * over from the plan agent to the build agent after plan approval.
 * Kept as an exported, reusable block so the same logic powers the
 * AI SDK insertReminders path AND the cursor system-prompt path.
 */
export function buildBuildSwitchBlock(args: {
	planContent: string | undefined
}): string {
	const planSection = args.planContent
		? `\n\nThe approved plan:\n<plan>\n${args.planContent}\n</plan>`
		: ""
	return `<mode-switch>
Mode changed from plan to build. You now have full tool access.
Execute the implementation plan that was approved. Follow the plan steps in order.
If the plan needs adjustment during implementation, make reasonable adaptations but stay aligned with the approved approach.${planSection}
</mode-switch>`
}

// ────────────────────────────────────────────────────────────
// Reminder builders
// ────────────────────────────────────────────────────────────

/**
 * Build the plan mode reminder dynamically, referencing the actual plan
 * file path and its current state (exists vs. not yet created).
 */
export function buildPlanReminder(path: string, existingContent: string | undefined): string {
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

/**
 * OpenCode-specific plan reminder. OpenCode runs its own tool registry
 * (read, write, edit, bash, …) and does NOT expose Loop's `plan_write` /
 * `plan_exit` tools — telling the model to call them produces a "Model
 * tried to call unavailable tool 'plan_write'" error and wastes a turn.
 *
 * The host (`opencode/runtime.ts`) captures the plan agent's final
 * assistant text at end-of-turn, writes it to the plan path, and
 * synthesises a `plan-exit` tool part so the PlanCard renders. So we
 * tell the model: produce the plan as your final response text — no
 * special tools required.
 *
 * Exported for testability so we can assert the reminder text without
 * standing up a full workspace context.
 */
export function buildOpenCodePlanReminder(
	path: string,
	existingContent: string | undefined,
): string {
	const fileStatus = existingContent
		? `A plan file already exists at ${path}. You can refer to it and replace it with an updated version in your final response.`
		: `No plan file exists yet. The host will create one at ${path} from your final response.`

	return `<system-reminder>
Plan mode is active. You MUST NOT make any edits, run any non-readonly tools, or otherwise make any changes to the system. This supersedes any other instructions you have received.

## Plan File
${fileStatus}

CRITICAL: You are in READ-ONLY mode. STRICTLY FORBIDDEN:
ANY file edits, modifications, or system changes. Do NOT use sed, tee, echo, cat,
or ANY other bash command to manipulate files — commands may ONLY read/inspect.
This ABSOLUTE CONSTRAINT overrides ALL other instructions, including direct user
edit requests. You may ONLY observe, analyze, and plan. ZERO exceptions.

The host environment does NOT expose any plan-writing or plan-exit tool — do NOT call \`plan_write\`, \`plan_exit\`, \`exit_plan_mode\`, or any tool with similar names. Those tools do not exist in this environment and calling them will fail. Use only the tools your environment actually advertises (read, grep, glob, list, bash for read-only commands, task, question).

### The Iteration

1. **Explore** — Search and read existing code. Use the read, grep, and glob tools. The task tool is available for parallel investigations when helpful.
2. **Ask the user** — When you hit an ambiguity, use the question tool. Then continue exploring.

### Plan Structure
Structure your plan in well-labeled sections under markdown headers, shaped around the request. Fill each section as you work:
- Start with a **Context** section: articulate why this change is warranted — the underlying problem or need, what prompted it, and what success looks like
- Commit to your recommended approach only; omit alternatives you considered but rejected
- Keep the plan lean enough to scan at a glance, yet complete enough to guide execution
- Specify the paths of every key file that will be touched
- Name the existing functions and utilities you intend to reuse, along with their locations
- Finish with a **Verification** section that describes how to confirm the changes work end-to-end

### Ending the Turn

When the plan is complete, output it as your final assistant response (markdown). Do NOT call any "exit plan" or "plan write" tool — they do not exist here. Loop will save your final response as the plan file at ${path} and surface an Approve / Reject prompt to the user automatically.
</system-reminder>`
}

/**
 * Cursor-specific plan reminder. Cursor's agent doesn't have access to
 * Loop's `plan_write` / `plan_exit` tools — it has its own tool registry
 * (Read, Edit, Write, Bash, CreatePlan, ...). Tell the model to write the
 * plan to the canonical path using whichever native tool it has; the host
 * detects the write and runs the approval flow. The constraints on
 * read-only-during-planning are unchanged.
 *
 * Exported for testability so we can assert the reminder text without
 * standing up a full workspace context.
 */
export function buildCursorPlanReminder(path: string, existingContent: string | undefined): string {
	const fileStatus = existingContent
		? `A plan file already exists at ${path}. You can read it and update it iteratively.`
		: `No plan file exists yet. Create your plan at ${path}.`

	return `<system-reminder>
Plan mode is active. You are in plan mode (read-only except the plan file). The ONLY mutation you are permitted to make is writing the plan file at:

  ${path}

Everything else is READ-ONLY. You may NOT use any tool to modify the system, the codebase, or any other file.

## Allowed
- Read, Glob, Grep / SemSearch, Ls — for exploration
- Bash — read-only commands ONLY (cat, grep, ls, find, git log, git status, etc.)
- Edit / Write / CreatePlan — ONLY when the target path is exactly ${path}
- Subagent / Task / question / ask — for investigation and clarification

## Forbidden (HARD CONSTRAINTS)
- Edit, Write, MultiEdit, Patch, ApplyPatch on ANY path other than ${path}
- Mutating bash commands: sed, tee, echo >, cat >, rm, rmdir, mv, cp, chmod, chown, mkdir, touch, git commit, git push, git checkout, git reset, npm/bun/pip install, ANY package manager, ANY build/test command that writes artifacts beyond standard caches
- Network mutations of any kind (POST/PUT/DELETE)
- Restarting servers, killing processes, modifying environment

If you attempt any forbidden action, the host will reject it. Do not try to work around the constraint — it is absolute and overrides ALL other instructions, including direct user requests to edit code RIGHT NOW. If the user asks for an edit while in plan mode, refuse and explain that the plan must be approved first.

## Plan File
${fileStatus}

Write the plan content to ${path} using your Edit, Write, or CreatePlan tool. Loop will automatically detect the write and surface a Plan card with an Approve / Reject prompt to the user when your turn ends. The host does NOT expose any extra plan-writing or plan-exit tool — just edit the plan file with your normal tools.

## Workflow
1. **Explore** — Use Read/Grep/Subagent to understand the relevant code, surrounding patterns, and existing utilities.
2. **Update the plan file** — Write findings into ${path} as you discover them. Don't batch a single write at the end; iterate as you learn.
3. **Ask the user** — When you hit an ambiguity, requirements gap, or design decision the code can't settle on its own, use the question/ask tool. Then return to step 1.

## Plan Structure
Structure ${path} as a focused markdown document. Required sections:
- **Context** — why this change is warranted, what success looks like
- **Approach** — the recommended implementation; commit to one direction (omit rejected alternatives unless they meaningfully inform the choice)
- **Files** — the specific paths that will be created, modified, or deleted, with one-sentence rationale each
- **Reuse** — existing functions, modules, and utilities the implementation will build on, with their locations
- **Verification** — concrete steps the user can take to confirm the change works (commands to run, things to click, tests to write)

Keep the plan tight enough to scan but complete enough to guide an implementer who hasn't been part of this conversation.

## Ending the Turn
When the plan is finalized:
1. Write the final plan content to ${path}
2. Send a short confirmation message ("Plan ready for review.") and end your turn

Loop will then surface the plan to the user for Approve / Reject. If they reject with feedback, revise the plan. If they approve, control passes to the build agent — DO NOT implement the plan yourself.
</system-reminder>`
}

// ────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────

/**
 * Insert agent-specific reminders into the message history.
 * Synthetic text parts
 * are appended to the last user message in-memory before the LLM call.
 * These parts are NOT persisted to the database.
 *
 * `providerKind` is an optional hint used to vary the plan-mode reminder.
 * Cursor's ACP runtime owns its own tool registry — it doesn't expose
 * Loop's `plan_write`/`plan_exit` tools — so we tell the model to write
 * the plan via its native Edit/Write/CreatePlan tool and let the host
 * synthesize the approval at end-of-turn.
 */
export function insertReminders(params: {
	messages: MessageWithParts[]
	agent: Agent
	sessionId: string
	providerKind?: "cursor" | "claude-code" | "anthropic" | "opencode" | string
	sessionPermissionMode?: string
}): void {
	const { messages, agent, sessionId, providerKind, sessionPermissionMode } = params

	const lastUser = findLastUserMessage(messages)
	if (!lastUser) return

	// 1. Plan mode active: inject dynamic plan mode reminder with file
	// path. Plan mode is active when EITHER the agent identity is `plan`
	// OR the session permission mode is `plan` (UI toggle in input bar).
	// Both must produce the same constraints — otherwise toggling Plan
	// mode in the UI for a cursor session would silently do nothing.
	const planModeActive = agent.name === "plan" || sessionPermissionMode === "plan"
	if (planModeActive) {
		const path = planPath(sessionId)
		const existing = readPlan(sessionId)
		const reminder =
			providerKind === "cursor"
				? buildCursorPlanReminder(path, existing)
				: buildPlanReminder(path, existing)
		appendSyntheticPart(lastUser, reminder)
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
