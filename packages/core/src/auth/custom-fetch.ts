/**
 * Custom Fetch Wrappers -- inject OAuth tokens and provider-specific headers.
 *
 * When a provider is authenticated via OAuth (not API key), the AI SDK adapter
 * needs a custom `fetch` function that:
 * 1. Injects the OAuth access token as a Bearer token
 * 2. Adds provider-specific headers (Copilot user-agent, Anthropic beta, etc.)
 * 3. Handles transparent token refresh on expiration
 *
 * The custom fetch is injected into the adapter via `config.options.fetch`.
 */

import {
  getProviderAuth,
  isTokenExpired,
  refreshOAuthToken,
} from './store.js';

/** Function that returns a fresh access token, refreshing if needed. */
export type TokenProvider = () => Promise<string>;

// ── Provider-specific OAuth refresh configs ─────────────────────────────
//
// These are the subset of PKCE / Device-Code configs required for token
// refresh.  They are duplicated here (rather than importing the full flow
// modules) to avoid pulling in `node:crypto` / `node:http` at runtime in
// environments that only need the fetch wrapper.

interface OAuthRefreshConfig {
  type: 'pkce' | 'copilot';
  tokenUrl: string;
  clientId: string;
}

const OAUTH_REFRESH_CONFIGS: Record<string, OAuthRefreshConfig> = {
  openai: {
    type: 'pkce',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  },
  anthropic: {
    type: 'pkce',
    tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  },
  'github-copilot': {
    type: 'copilot',
    tokenUrl: 'https://api.github.com/copilot_internal/v2/token',
    clientId: 'Iv1.b507a08c87ecfe98',
  },
};

// ── Token provider factory ──────────────────────────────────────────────

/**
 * Create a `TokenProvider` function for a given OAuth-authenticated provider.
 *
 * The returned async function:
 * 1. Reads the stored auth from the auth store.
 * 2. If the token is still valid, returns it immediately.
 * 3. If expired, attempts a transparent refresh using the stored refresh token.
 * 4. Throws if no auth is stored or refresh fails.
 *
 * This is the recommended way to build a `getToken` callback for
 * `buildOAuthFetch()` in the execution loop.
 */
export function makeTokenProvider(providerId: string): TokenProvider {
  return async (): Promise<string> => {
    const auth = await getProviderAuth(providerId);
    if (!auth || auth.type !== 'oauth') {
      throw new Error(`No OAuth credentials stored for provider: ${providerId}`);
    }

    // Token still valid → return immediately
    if (!isTokenExpired(auth)) {
      return auth.accessToken;
    }

    // Attempt refresh
    const refreshConfig = OAUTH_REFRESH_CONFIGS[providerId];
    if (!refreshConfig) {
      // No refresh config -- return stale token; the provider may reject it
      // with a 401 which surfaces as a retryable error.
      return auth.accessToken;
    }

    if (refreshConfig.type === 'copilot') {
      // Copilot: the "refreshToken" is the GitHub access token.
      // We re-fetch a short-lived Copilot API token.
      const resp = await fetch(refreshConfig.tokenUrl, {
        headers: {
          Authorization: `token ${auth.refreshToken}`,
          Accept: 'application/json',
        },
      });
      if (!resp.ok) {
        throw new Error(`Copilot token refresh failed: ${resp.status}`);
      }
      const data = (await resp.json()) as { token: string; expires_at: number };
      const { setProviderAuth } = await import('./store.js');
      await setProviderAuth(providerId, {
        ...auth,
        accessToken: data.token,
        expiresAt: data.expires_at * 1000,
      });
      return data.token;
    }

    // Standard PKCE refresh
    return refreshOAuthToken(providerId, refreshConfig.tokenUrl, refreshConfig.clientId);
  };
}

// ── Custom fetch builder ────────────────────────────────────────────────

/**
 * Build a custom fetch function that injects OAuth tokens and provider headers.
 *
 * This wraps the global `fetch` and is passed to AI SDK adapters via their
 * `fetch` option, making OAuth transparent to the adapter code.
 */
export function buildOAuthFetch(
  providerId: string,
  getToken: TokenProvider,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = await getToken();
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);

    // Provider-specific headers
    applyProviderHeaders(providerId, headers);

    return fetch(input, { ...init, headers });
  };
}

/**
 * Apply provider-specific HTTP headers required for OAuth-authenticated requests.
 *
 * Each provider has unique header requirements documented in their API specs.
 */
function applyProviderHeaders(providerId: string, headers: Headers): void {
  switch (providerId) {
    case 'github-copilot':
      // Copilot API requires specific user-agent and editor headers
      headers.set('User-Agent', 'GitHubCopilotChat/0.35.0');
      headers.set('Editor-Version', 'vscode/1.107.0');
      headers.set('Editor-Plugin-Version', 'copilot-chat/0.35.0');
      headers.set('Copilot-Integration-Id', 'vscode-chat');
      break;

    case 'anthropic':
      // Anthropic OAuth requires beta feature headers
      headers.set(
        'anthropic-beta',
        'oauth-2025-04-20,interleaved-thinking-2025-05-14',
      );
      break;

    case 'openai':
      // OpenAI ChatGPT OAuth -- no additional headers needed beyond Bearer
      // The chatgpt-account-id is extracted from the JWT and passed separately
      break;
  }
}

/**
 * Get the base URL override for OAuth-authenticated providers.
 *
 * Some providers use a different API endpoint when authenticated via OAuth
 * versus API key (e.g., ChatGPT uses chatgpt.com instead of api.openai.com).
 */
export function getOAuthBaseUrl(
  providerId: string,
  metadata?: Record<string, string>,
): string | undefined {
  switch (providerId) {
    case 'openai':
      // ChatGPT Pro/Plus uses a different backend
      if (metadata?.source === 'chatgpt') {
        return 'https://chatgpt.com/backend-api';
      }
      return undefined;

    case 'github-copilot':
      return 'https://api.githubcopilot.com';

    default:
      return undefined;
  }
}
