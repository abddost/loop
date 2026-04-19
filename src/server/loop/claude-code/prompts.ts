/**
 * SDK permission modes. Kept as a type alias to avoid coupling to a
 * specific SDK version — the runtime passes this to `query({ options })`.
 */
export type SdkPermissionMode =
	| "default"
	| "acceptEdits"
	| "bypassPermissions"
	| "plan"
	| "dontAsk"
	| "auto"

/**
 * Map a Loop session permission mode onto the SDK's `permissionMode` enum.
 *
 * Loop's build/plan agent distinction applies only to the AI-SDK runtime.
 * For Claude Code we forward the session-level preference and let the
 * SDK's built-in persona and permission enforcement drive the rest.
 */
export function resolveSdkPermissionMode(sessionPermissionMode: string): SdkPermissionMode {
	switch (sessionPermissionMode) {
		case "full-access":
			return "bypassPermissions"
		case "auto-accept-edits":
			return "acceptEdits"
		case "plan":
			return "plan"
		default:
			return "default"
	}
}

/**
 * Whether the SDK query needs `allowDangerouslySkipPermissions: true`.
 *
 * Required when `permissionMode` is `"bypassPermissions"` — the SDK
 * refuses to run without this flag as a safety interlock.
 */
export function needsDangerousSkip(mode: SdkPermissionMode): boolean {
	return mode === "bypassPermissions"
}
