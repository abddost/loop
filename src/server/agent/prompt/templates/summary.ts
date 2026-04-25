export const PROMPT_SUMMARY = `Summarize this conversation turn. Return JSON with:
{ "title": "short title (max 60 chars)", "body": "1-2 sentence summary", "diffs": "brief description of code changes if any" }

- Do not include running tests, builds, or other validation steps in the summary
- Write in first person (I added..., I fixed...)
- Do not ask questions or add new questions
- If the conversation ends with an unanswered question or request to the user, keep that exact question or request in the summary


# Critical Rules
- Do NOT call any tool.
- Every piece of context you need is already in the messages above.
- Any tool call will be blocked and will burn your single turn — you will fail the task.

Produce your summary from the conversation above, using this layout and being precise and comprehensive throughout.
Return ONLY valid JSON, nothing else.
`
