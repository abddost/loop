import type { AuthMethodInfo, AuthPrompt, OAuthAuth } from "@core/schema/provider"

// ─── Types ──────────────────────────────────────────────────────

export type { AuthMethodInfo, AuthPrompt }

export interface AuthAuthorization {
	url: string
	userCode?: string
	method: "auto" | "code" | "redirect"
	instructions: string
	/** Poll until the user completes authorization. */
	poll(): Promise<AuthResult>
}

export type AuthResult =
	| {
			type: "success"
			accessToken: string
			refreshToken: string
			expiresAt: number
			accountId?: string
	  }
	| { type: "pending" }
	| { type: "failed"; error: string }

/**
 * An auth handler encapsulates the authentication logic for a specific provider.
 * Each handler declares its supported methods (API key, OAuth variants)
 * and provides authorize/fetch customization.
 */
export interface AuthHandler {
	providerId: string
	methods: AuthMethodInfo[]

	/**
	 * Start authorization for a specific method.
	 * @param methodId - Which method to use (matches AuthMethodInfo.id)
	 * @param inputs - User-provided values from the method's prompts
	 */
	authorize(methodId: string, inputs?: Record<string, string>): Promise<AuthAuthorization>

	/**
	 * Create a custom fetch function for this provider.
	 * Handles token injection, refresh, URL rewriting, etc.
	 * Returns undefined to use the default fetch.
	 */
	createFetch?(
		getAuth: () => Promise<OAuthAuth | undefined>,
		setAuth: (auth: OAuthAuth) => Promise<void>,
	): typeof fetch | undefined
}

// ─── Handler Registry ───────────────────────────────────────────

const handlers = new Map<string, AuthHandler>()

export function registerAuthHandler(handler: AuthHandler): void {
	handlers.set(handler.providerId, handler)
}

export function getAuthHandler(providerId: string): AuthHandler | undefined {
	return handlers.get(providerId)
}

export function listAuthHandlers(): AuthHandler[] {
	return Array.from(handlers.values())
}
