export const PROMPT_SUMMARY = `Summarize this conversation turn. Return JSON with:
{ "title": "short title (max 60 chars)", "body": "1-2 sentence summary", "diffs": "brief description of code changes if any" }
Return ONLY valid JSON, nothing else.`
