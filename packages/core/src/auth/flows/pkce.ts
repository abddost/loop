/**
 * PKCE OAuth 2.0 Flow
 *
 * Implements the Proof Key for Code Exchange (PKCE) flow used by:
 * - OpenAI ChatGPT Pro/Plus (browser-based with local callback server)
 * - Anthropic Claude Pro/Max (code-based with manual paste)
 *
 * PKCE adds security to the public client OAuth flow by proving that the
 * same client that initiated the flow is the one exchanging the code.
 */

import { randomBytes, createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { OAuthTokenResponse } from '@coding-assistant/shared';

// ── Known provider PKCE configurations ──────────────────────────────────

export interface PKCEConfig {
  clientId: string;
  authorizeUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scopes: string[];
}

export const PKCE_CONFIGS: Record<string, PKCEConfig> = {
  openai: {
    clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
    authorizeUrl: 'https://auth.openai.com/oauth/authorize',
    tokenUrl: 'https://auth.openai.com/oauth/token',
    redirectUri: 'http://localhost:1455/auth/callback',
    scopes: ['openid', 'profile', 'email', 'offline_access'],
  },
  anthropic: {
    clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
    authorizeUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
    redirectUri: 'https://console.anthropic.com/oauth/code/callback',
    scopes: ['org:create_api_key', 'user:profile', 'user:inference'],
  },
};

// ── PKCE challenge generation ───────────────────────────────────────────

interface PKCEChallenge {
  verifier: string;
  challenge: string;
}

/** Generate a cryptographically random PKCE verifier and its SHA-256 challenge. */
function generatePKCE(): PKCEChallenge {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// ── Authorization URL builder ───────────────────────────────────────────

export interface PKCEAuthResult {
  /** Full authorization URL to open in the user's browser */
  url: string;
  /** PKCE verifier (must be stored server-side for the token exchange) */
  verifier: string;
  /** State parameter for CSRF protection */
  state: string;
}

/**
 * Build the PKCE authorization URL for a provider.
 *
 * Returns the URL to redirect the user to, plus the verifier and state
 * that must be stored until the callback completes the flow.
 */
export function startPKCEAuth(providerId: string): PKCEAuthResult {
  const config = PKCE_CONFIGS[providerId];
  if (!config) {
    throw new Error(`No PKCE configuration for provider: ${providerId}`);
  }

  const { verifier, challenge } = generatePKCE();
  const state = randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });

  return {
    url: `${config.authorizeUrl}?${params}`,
    verifier,
    state,
  };
}

// ── Token exchange ──────────────────────────────────────────────────────

/**
 * Exchange an authorization code for tokens using the PKCE verifier.
 *
 * This completes the PKCE flow -- the authorization server validates that
 * the verifier matches the challenge sent during authorization.
 */
export async function exchangePKCECode(
  providerId: string,
  code: string,
  verifier: string,
): Promise<OAuthTokenResponse> {
  const config = PKCE_CONFIGS[providerId];
  if (!config) {
    throw new Error(`No PKCE configuration for provider: ${providerId}`);
  }

  const resp = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(
      `PKCE token exchange failed for ${providerId}: ${resp.status} ${resp.statusText}${body ? ` -- ${body}` : ''}`,
    );
  }

  return (await resp.json()) as OAuthTokenResponse;
}

// ── Local callback server ───────────────────────────────────────────────

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Start a temporary local HTTP server to receive the OAuth callback.
 *
 * Used for "browser" PKCE flows (e.g. OpenAI ChatGPT) where the
 * authorization server redirects to localhost with the auth code.
 *
 * Returns a promise that resolves with the authorization code.
 * The server shuts down automatically after receiving the code or on timeout.
 */
export function startCallbackServer(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let server: Server | undefined;

    const timeout = setTimeout(() => {
      server?.close();
      reject(new Error('OAuth callback timeout -- no authorization code received'));
    }, CALLBACK_TIMEOUT_MS);

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end(`<html><body><h1>Authorization Failed</h1><p>${error}</p></body></html>`);
        clearTimeout(timeout);
        server?.close();
        reject(new Error(`OAuth authorization denied: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<html><body><h1>Authorization successful!</h1>' +
          '<p>You can close this tab and return to the app.</p></body></html>',
        );
        clearTimeout(timeout);
        server?.close();
        resolve(code);
        return;
      }

      // Ignore other requests (favicon, etc.)
      res.writeHead(404);
      res.end();
    });

    server.listen(port, () => {
      // Server ready
    });

    server.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start callback server on port ${port}: ${err.message}`));
    });
  });
}
