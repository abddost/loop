/**
 * Max-steps reminder -- injected when the agent exhausts its step budget.
 *
 * Modeled after OpenCode's max-steps.txt prompt. Tells the LLM to stop
 * calling tools and respond with a text summary of progress and next steps.
 */

export const MAX_STEPS_REMINDER = `<system-reminder>
CRITICAL - MAXIMUM STEPS REACHED

The maximum number of tool-use steps allowed for this task has been reached.
Tools are disabled until the next user message.

You must respond with text only. Your response must include:
1. Summary of what has been accomplished so far
2. List of remaining tasks that were not completed
3. Recommendations for what should be done next

Do NOT attempt to call any tools. Respond with a helpful text summary.
</system-reminder>`;
