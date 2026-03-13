/**
 * Returns an XML reminder block for the current plan/build mode.
 * Injected as step 7 of the system prompt assembly.
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
