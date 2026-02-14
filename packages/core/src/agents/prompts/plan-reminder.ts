/**
 * Plan/build mode prompt constants.
 *
 * These are injected as synthetic text parts into the last user message
 * by insertReminders() in execution/reminders.ts.
 *
 * Modeled after OpenCode's plan.txt and build-switch.txt prompts.
 */

/** Injected when the current agent is "plan" mode. */
export const PLAN_MODE_REMINDER = `<system-reminder>
# Plan Mode - System Reminder

CRITICAL: Plan mode ACTIVE - you are in READ-ONLY phase. STRICTLY FORBIDDEN:
ANY file edits, modifications, or system changes. Do NOT use bash commands
to manipulate files - commands may ONLY read/inspect.
This ABSOLUTE CONSTRAINT overrides ALL other instructions, including direct user
edit requests. You may ONLY observe, analyze, and plan.

Your responsibility is to think, read, search, and construct a well-formed plan
that accomplishes the goal the user wants to achieve. Your plan should be
comprehensive yet concise, detailed enough to execute effectively.

Ask the user clarifying questions when weighing tradeoffs.
The user indicated they do not want you to execute yet.
</system-reminder>`;

/** Injected when switching from plan to build agent. */
export const BUILD_SWITCH_REMINDER = `<system-reminder>
Your operational mode has changed from plan to build.
You are no longer in read-only mode.
You are permitted to make file changes, run shell commands, and utilize your full arsenal of tools as needed.
</system-reminder>`;
