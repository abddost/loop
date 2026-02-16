/**
 * Authentication types for the multi-method provider auth system.
 *
 * Supports three auth strategies:
 * 1. API key (traditional, all providers)
 * 2. OAuth PKCE (OpenAI ChatGPT, Anthropic Claude Pro)
 * 3. OAuth Device Code (GitHub Copilot)
 */

import type { ProviderCredentialField } from './provider.js';

// ── Stored auth state ───────────────────────────────────────────────────

/**
 * Discriminated union of stored authentication info for a provider.
 * Persisted to `~/.coding-assistant/auth.json`.
 */
export type ProviderAuth =
  | ApiKeyAuth
  | OAuthAuth;

export interface ApiKeyAuth {
  type: 'api_key';
  apiKey: string;
}

export interface OAuthAuth {
  type: 'oauth';
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires */
  expiresAt: number;
  /** Provider-specific metadata (e.g. chatgpt_account_id, copilot token) */
  metadata?: Record<string, string>;
}

// ── Auth method definitions ─────────────────────────────────────────────

/** The type of auth flow to execute. */
export type AuthFlowType =
  | 'api_key'
  | 'oauth_pkce_browser'   // PKCE with local callback server (auto)
  | 'oauth_pkce_code'      // PKCE with manual code paste
  | 'oauth_device_code';   // GitHub device code flow

/**
 * Describes one authentication method a provider supports.
 * A provider can offer multiple methods (e.g. OpenAI offers ChatGPT OAuth + API key).
 */
export interface AuthMethod {
  /** Unique ID within the provider (e.g. 'chatgpt-browser', 'api-key') */
  id: string;
  type: AuthFlowType;
  /** Human-readable label (e.g. "ChatGPT Pro/Plus (browser)") */
  label: string;
  /** Brief description shown in the UI */
  description?: string;
  /** Credential fields for api_key type only */
  fields?: ProviderCredentialField[];
}

// ── OAuth flow responses ────────────────────────────────────────────────

/**
 * Returned to the UI when an OAuth flow is initiated.
 * The UI uses this to open the browser and/or show instructions.
 */
export interface OAuthAuthorization {
  /** URL to open in the user's browser */
  url: string;
  /**
   * How the callback is handled:
   * - 'auto': local callback server captures the code automatically
   * - 'code': user must paste the authorization code manually
   */
  method: 'auto' | 'code';
  /** For device_code flows: the user code to display (e.g. "XXXX-XXXX") */
  userCode?: string;
  /** Human-readable instructions for the user */
  instructions?: string;
}

// ── OAuth token response ────────────────────────────────────────────────

/** Standard OAuth 2.0 token endpoint response. */
export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}
