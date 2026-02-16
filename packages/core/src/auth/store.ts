/**
 * Secure Auth Store -- persists provider authentication tokens.
 *
 * Stores credentials in `~/.coding-assistant/auth.json` with restrictive
 * file permissions (0o600 = owner read/write only) to protect sensitive
 * tokens like OAuth access/refresh tokens.
 *
 * Separate from the main config file because:
 * 1. Auth tokens are more sensitive than general config
 * 2. Different lifecycle (tokens expire, need refresh)
 * 3. Cleaner separation of concerns
 */

import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ProviderAuth, OAuthTokenResponse } from '@coding-assistant/shared';

const AUTH_DIR = join(homedir(), '.coding-assistant');
const AUTH_FILE = join(AUTH_DIR, 'auth.json');

// ── Store operations ────────────────────────────────────────────────────

/**
 * Read all stored auth entries.
 * Returns an empty object if the file doesn't exist or is malformed.
 */
export async function readAuthStore(): Promise<Record<string, ProviderAuth>> {
  try {
    const content = await readFile(AUTH_FILE, 'utf-8');
    return JSON.parse(content) as Record<string, ProviderAuth>;
  } catch {
    return {};
  }
}

/**
 * Save auth credentials for a provider.
 * Creates the directory and sets restrictive permissions.
 */
export async function setProviderAuth(
  providerId: string,
  auth: ProviderAuth,
): Promise<void> {
  const store = await readAuthStore();
  store[providerId] = auth;
  await writeStore(store);
}

/**
 * Remove auth credentials for a provider.
 */
export async function removeProviderAuth(providerId: string): Promise<void> {
  const store = await readAuthStore();
  delete store[providerId];
  await writeStore(store);
}

/**
 * Get auth credentials for a specific provider.
 */
export async function getProviderAuth(
  providerId: string,
): Promise<ProviderAuth | null> {
  const store = await readAuthStore();
  return store[providerId] ?? null;
}

/**
 * Check if a provider's OAuth token is expired (with 5-minute buffer).
 */
export function isTokenExpired(auth: ProviderAuth): boolean {
  if (auth.type !== 'oauth') return false;
  const BUFFER_MS = 5 * 60 * 1000; // 5 minutes
  return auth.expiresAt - BUFFER_MS < Date.now();
}

// ── Token refresh ───────────────────────────────────────────────────────

/**
 * Refresh an expired OAuth token using the stored refresh token.
 *
 * Updates the store with the new tokens and returns the fresh access token.
 * Throws if the provider is not OAuth-authenticated or the refresh fails.
 */
export async function refreshOAuthToken(
  providerId: string,
  tokenUrl: string,
  clientId: string,
): Promise<string> {
  const store = await readAuthStore();
  const auth = store[providerId];

  if (!auth || auth.type !== 'oauth') {
    throw new Error(`No OAuth credentials stored for provider: ${providerId}`);
  }

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      refresh_token: auth.refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!resp.ok) {
    throw new Error(`Token refresh failed for ${providerId}: ${resp.status} ${resp.statusText}`);
  }

  const data = (await resp.json()) as OAuthTokenResponse;

  // Update stored tokens
  auth.accessToken = data.access_token;
  if (data.refresh_token) {
    auth.refreshToken = data.refresh_token;
  }
  auth.expiresAt = Date.now() + ((data.expires_in ?? 3600) * 1000);

  await setProviderAuth(providerId, auth);
  return auth.accessToken;
}

// ── Internal helpers ────────────────────────────────────────────────────

async function writeStore(store: Record<string, ProviderAuth>): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true });
  await writeFile(AUTH_FILE, JSON.stringify(store, null, 2), 'utf-8');

  // Restrictive permissions: owner read/write only
  try {
    await chmod(AUTH_FILE, 0o600);
  } catch {
    // chmod may fail on some platforms (e.g., Windows) -- non-fatal
  }
}
