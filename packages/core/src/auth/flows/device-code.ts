/**
 * OAuth 2.0 Device Code Flow
 *
 * Used by GitHub Copilot for authentication. The flow works on
 * devices that can't easily handle browser redirects:
 *
 * 1. Request a device code from GitHub
 * 2. Show the user a verification URL and user code
 * 3. User enters the code in their browser
 * 4. Poll GitHub until the user authorizes
 * 5. Exchange the GitHub token for a Copilot API token
 */

// ── Known provider device code configurations ───────────────────────────

export interface DeviceCodeConfig {
  clientId: string;
  deviceCodeUrl: string;
  accessTokenUrl: string;
  copilotTokenUrl: string;
  apiBase: string;
}

export const DEVICE_CODE_CONFIGS: Record<string, DeviceCodeConfig> = {
  'github-copilot': {
    clientId: 'Iv1.b507a08c87ecfe98',
    deviceCodeUrl: 'https://github.com/login/device/code',
    accessTokenUrl: 'https://github.com/login/oauth/access_token',
    copilotTokenUrl: 'https://api.github.com/copilot_internal/v2/token',
    apiBase: 'https://api.githubcopilot.com',
  },
};

// ── Device code response ────────────────────────────────────────────────

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
}

// ── Request a device code ───────────────────────────────────────────────

/**
 * Request a device code from the authorization server.
 *
 * Returns the device code, user code, and verification URI that the
 * user needs to visit to authorize the application.
 */
export async function requestDeviceCode(
  providerId: string,
): Promise<DeviceCodeResponse> {
  const config = DEVICE_CODE_CONFIGS[providerId];
  if (!config) {
    throw new Error(`No device code configuration for provider: ${providerId}`);
  }

  const resp = await fetch(config.deviceCodeUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ client_id: config.clientId }),
  });

  if (!resp.ok) {
    throw new Error(`Device code request failed: ${resp.status} ${resp.statusText}`);
  }

  return (await resp.json()) as DeviceCodeResponse;
}

// ── Poll for access token ───────────────────────────────────────────────

interface PollResult {
  access_token: string;
  token_type?: string;
  scope?: string;
}

/**
 * Poll the authorization server until the user completes authorization.
 *
 * Respects the `interval` parameter and handles standard error responses:
 * - `authorization_pending`: keep polling
 * - `slow_down`: increase interval by 5 seconds
 * - `expired_token`: user took too long, abort
 * - `access_denied`: user denied, abort
 */
export async function pollForToken(
  providerId: string,
  deviceCode: string,
  interval: number,
  signal: AbortSignal,
): Promise<PollResult> {
  const config = DEVICE_CODE_CONFIGS[providerId];
  if (!config) {
    throw new Error(`No device code configuration for provider: ${providerId}`);
  }

  let currentInterval = interval;

  while (!signal.aborted) {
    await new Promise((resolve) => setTimeout(resolve, currentInterval * 1000));

    if (signal.aborted) break;

    const resp = await fetch(config.accessTokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: config.clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    const data = await resp.json() as Record<string, unknown>;

    // Success
    if (data.access_token && typeof data.access_token === 'string') {
      return data as unknown as PollResult;
    }

    // Standard error responses
    const error = data.error as string | undefined;
    if (error === 'expired_token') {
      throw new Error('Device code expired. Please try again.');
    }
    if (error === 'access_denied') {
      throw new Error('Authorization was denied by the user.');
    }
    if (error === 'slow_down') {
      currentInterval += 5;
    }
    // 'authorization_pending' -> keep polling
  }

  throw new Error('Device code polling was aborted.');
}

// ── Copilot token exchange ──────────────────────────────────────────────

export interface CopilotToken {
  token: string;
  expires_at: number;
}

/**
 * Exchange a GitHub access token for a Copilot API token.
 *
 * The Copilot token is short-lived and must be refreshed using the
 * GitHub access token before each expiration.
 */
export async function getCopilotToken(
  accessToken: string,
  providerId: string,
): Promise<CopilotToken> {
  const config = DEVICE_CODE_CONFIGS[providerId];
  if (!config) {
    throw new Error(`No device code configuration for provider: ${providerId}`);
  }

  const resp = await fetch(config.copilotTokenUrl, {
    headers: {
      Authorization: `token ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!resp.ok) {
    throw new Error(
      `Copilot token fetch failed: ${resp.status} ${resp.statusText}`,
    );
  }

  return (await resp.json()) as CopilotToken;
}
