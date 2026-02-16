/**
 * Provider routes -- global provider management (no workspaceId).
 *
 * Provider credentials are user-level and stored in the global config
 * (~/.coding-assistant/config.json), not scoped to any workspace.
 *
 * Also handles OAuth flows (PKCE, device code) for providers that support
 * subscription-based auth (ChatGPT Pro, Claude Pro, GitHub Copilot).
 */

import { Hono } from 'hono';
import type { ProviderCatalogEntry, OAuthAuthorization } from '@coding-assistant/shared';
import {
  modelCatalog,
  getCredentialSchema,
  testProviderConnection,
  credentialsToProviderConfig,
} from '@coding-assistant/core/providers/index.js';
import {
  getAuthMethods,
  readAuthStore,
  setProviderAuth,
  removeProviderAuth,
  startPKCEAuth,
  exchangePKCECode,
  startCallbackServer,
  requestDeviceCode,
  pollForToken,
  getCopilotToken,
} from '@coding-assistant/core/auth/index.js';
import {
  readGlobalConfig,
  writeGlobalConfig,
  getConnectedProviderIds,
  getConnectionStatuses,
  getConnectionStatus,
  setConnectionStatus,
  deleteConnectionStatus,
} from '../services/global-config.js';
import { parseBody, connectProviderSchema } from '../schemas/index.js';

// ── In-memory state for pending OAuth flows ─────────────────────────────

interface PendingPKCE {
  verifier: string;
  state: string;
  /** Captured code from auto callback server */
  code?: string;
}

interface PendingDeviceCode {
  deviceCode: string;
  interval: number;
}

type PendingAuth = PendingPKCE | PendingDeviceCode;

/** Tracks in-flight OAuth flows by providerId. Cleaned up on completion. */
const pendingAuth = new Map<string, PendingAuth>();

function isPendingPKCE(p: PendingAuth): p is PendingPKCE {
  return 'verifier' in p;
}

function isPendingDeviceCode(p: PendingAuth): p is PendingDeviceCode {
  return 'deviceCode' in p;
}

export const providersRouter = new Hono()
  /**
   * GET / -- List all providers segmented into connected, popular, other.
   */
  .get('/', async (c) => {
    // Merge both credential stores (config.json + auth.json) so OAuth
    // providers appear alongside API-key providers in the connected list.
    const { configProviders, oauthProviderIds, allConnectedIds } =
      await getConnectedProviderIds();

    // Build status map for ALL connected providers (config + OAuth)
    const statuses = getConnectionStatuses([...allConnectedIds]);

    // Ensure catalog is loaded
    if (modelCatalog.needsRefresh) {
      await modelCatalog.refresh();
    }

    const entries = modelCatalog.getProviderCatalogEntries(
      configProviders,
      statuses,
      oauthProviderIds,
    );

    // Segment for the UI
    const connected: ProviderCatalogEntry[] = [];
    const popular: ProviderCatalogEntry[] = [];
    const other: ProviderCatalogEntry[] = [];

    for (const entry of entries) {
      const hasCredentials =
        Boolean(configProviders[entry.id]) || oauthProviderIds.has(entry.id);

      if (hasCredentials && (entry.connectionStatus === 'connected' || entry.connectionStatus === 'untested')) {
        connected.push(entry);
        continue;
      }

      if (entry.tier === 'popular') {
        popular.push(entry);
      } else {
        other.push(entry);
      }
    }

    return c.json({ connected, popular, other });
  })

  /**
   * GET /:id -- Single provider detail with credential schema.
   */
  .get('/:id', async (c) => {
    const providerId = c.req.param('id');
    const { configProviders, oauthProviderIds, allConnectedIds } =
      await getConnectedProviderIds();

    const hasCredentials = allConnectedIds.has(providerId);
    const statuses = hasCredentials
      ? { [providerId]: getConnectionStatus(providerId) }
      : {};

    if (modelCatalog.needsRefresh) {
      await modelCatalog.refresh();
    }

    const entries = modelCatalog.getProviderCatalogEntries(
      configProviders,
      statuses,
      oauthProviderIds,
    );
    const entry = entries.find((e) => e.id === providerId);

    if (!entry) {
      // Return a minimal entry with credential schema
      return c.json({
        provider: {
          id: providerId,
          name: providerId,
          description: '',
          website: '',
          tier: 'other' as const,
          credentialFields: getCredentialSchema(providerId),
          connectionStatus: 'disconnected' as const,
          modelCount: 0,
        },
      });
    }

    return c.json({ provider: entry });
  })

  /**
   * POST /:id/connect -- Test credentials and persist to global config.
   */
  .post('/:id/connect', async (c) => {
    const providerId = c.req.param('id');
    const body = await parseBody(c, connectProviderSchema);

    // Test the connection
    const result = await testProviderConnection(providerId, body.credentials);

    if (result.success) {
      // Persist credentials to global config
      const config = await readGlobalConfig();
      if (!config.providers) config.providers = {};

      const providerConfig = credentialsToProviderConfig(providerId, body.credentials);
      config.providers[providerId] = {
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        options: providerConfig.options,
      };

      await writeGlobalConfig(config);
      setConnectionStatus(providerId, 'connected');
    } else {
      setConnectionStatus(providerId, 'error');
    }

    return c.json(result);
  })

  /**
   * DELETE /:id/disconnect -- Remove provider credentials.
   */
  .delete('/:id/disconnect', async (c) => {
    const providerId = c.req.param('id');
    const config = await readGlobalConfig();

    // Remove API-key credentials from config.json
    if (config.providers?.[providerId]) {
      delete config.providers[providerId];
      await writeGlobalConfig(config);
    }

    // Also remove OAuth credentials from auth.json
    const authStore = await readAuthStore();
    if (authStore[providerId]) {
      await removeProviderAuth(providerId);
    }

    deleteConnectionStatus(providerId);

    return c.json({ success: true });
  })

  /**
   * POST /:id/test -- Test an already-configured provider.
   */
  .post('/:id/test', async (c) => {
    const providerId = c.req.param('id');
    const config = await readGlobalConfig();
    const providerEntry = config.providers?.[providerId];

    // Check OAuth store if no API-key config exists
    if (!providerEntry) {
      const authStore = await readAuthStore();
      const oauthEntry = authStore[providerId];

      if (!oauthEntry) {
        return c.json({
          success: false,
          providerId,
          errorMessage: 'Provider not configured. Connect it first.',
        }, 400);
      }

      // OAuth provider -- mark as connected if token is present
      // (full connection test would require making an API call with the OAuth token)
      setConnectionStatus(providerId, 'connected');
      return c.json({ success: true, providerId });
    }

    // Rebuild credentials from stored API-key config
    const credentials: Record<string, string> = {};
    if (providerEntry.apiKey) credentials.apiKey = providerEntry.apiKey;
    if (providerEntry.baseUrl) credentials.baseUrl = providerEntry.baseUrl;
    if (providerEntry.options) {
      for (const [k, v] of Object.entries(providerEntry.options)) {
        if (typeof v === 'string') credentials[k] = v;
      }
    }

    const result = await testProviderConnection(providerId, credentials);
    setConnectionStatus(providerId, result.success ? 'connected' : 'error');

    return c.json(result);
  })

  // ── OAuth / Multi-Auth Endpoints ────────────────────────────────────

  /**
   * GET /:id/auth-methods -- List available auth methods for a provider.
   *
   * Returns the auth methods defined in the auth registry.
   * Providers without custom methods get a default API key entry.
   */
  .get('/:id/auth-methods', (c) => {
    const providerId = c.req.param('id');
    const methods = getAuthMethods(providerId);
    return c.json({ methods });
  })

  /**
   * POST /:id/oauth/authorize -- Start an OAuth flow.
   *
   * Accepts { methodId } to identify which auth method to use.
   * Returns an OAuthAuthorization with the URL to open and flow instructions.
   */
  .post('/:id/oauth/authorize', async (c) => {
    const providerId = c.req.param('id');
    const { methodId } = (await c.req.json()) as { methodId: string };

    const methods = getAuthMethods(providerId);
    const method = methods.find((m) => m.id === methodId);

    if (!method) {
      return c.json({ error: `Unknown auth method: ${methodId}` }, 400);
    }

    // ── PKCE browser flow (auto callback via local server) ──
    if (method.type === 'oauth_pkce_browser') {
      const { url, verifier, state } = startPKCEAuth(providerId);
      const pending: PendingPKCE = { verifier, state };
      pendingAuth.set(providerId, pending);

      // Start callback server in the background -- captures the code
      startCallbackServer(1455)
        .then((code) => { pending.code = code; })
        .catch(() => { /* timeout or error -- handled on callback */ });

      const result: OAuthAuthorization = { url, method: 'auto' };
      return c.json(result);
    }

    // ── PKCE code flow (user pastes code manually) ──
    if (method.type === 'oauth_pkce_code') {
      const { url, verifier, state } = startPKCEAuth(providerId);
      pendingAuth.set(providerId, { verifier, state });

      const result: OAuthAuthorization = {
        url,
        method: 'code',
        instructions: 'Open the URL, authorize the app, then paste the code below.',
      };
      return c.json(result);
    }

    // ── Device code flow (GitHub Copilot) ──
    if (method.type === 'oauth_device_code') {
      const deviceInfo = await requestDeviceCode(providerId);
      pendingAuth.set(providerId, {
        deviceCode: deviceInfo.device_code,
        interval: deviceInfo.interval,
      });

      const result: OAuthAuthorization = {
        url: deviceInfo.verification_uri,
        method: 'auto',
        userCode: deviceInfo.user_code,
        instructions: `Go to ${deviceInfo.verification_uri} and enter code: ${deviceInfo.user_code}`,
      };
      return c.json(result);
    }

    return c.json({ error: `Unsupported auth flow type: ${method.type}` }, 400);
  })

  /**
   * POST /:id/oauth/callback -- Complete an OAuth flow.
   *
   * For PKCE code flows: accepts { code } from the user.
   * For auto flows: the code was captured by the callback server.
   * For device code: polls for the token.
   */
  .post('/:id/oauth/callback', async (c) => {
    const providerId = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { code?: string };
    const pending = pendingAuth.get(providerId);

    if (!pending) {
      return c.json({ error: 'No pending OAuth flow for this provider' }, 400);
    }

    try {
      // ── PKCE flows (browser or code) ──
      if (isPendingPKCE(pending)) {
        const authCode = body.code ?? pending.code;
        if (!authCode) {
          return c.json(
            { error: 'Authorization code not yet received. Wait for browser callback or provide a code.' },
            400,
          );
        }

        const tokens = await exchangePKCECode(providerId, authCode, pending.verifier);
        await setProviderAuth(providerId, {
          type: 'oauth',
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? '',
          expiresAt: Date.now() + ((tokens.expires_in ?? 3600) * 1000),
        });

        pendingAuth.delete(providerId);
        setConnectionStatus(providerId, 'connected');
        return c.json({ success: true });
      }

      // ── Device code flow ──
      if (isPendingDeviceCode(pending)) {
        const controller = new AbortController();
        // 5-minute timeout for the polling
        const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);

        try {
          const tokens = await pollForToken(
            providerId,
            pending.deviceCode,
            pending.interval,
            controller.signal,
          );

          // For Copilot: exchange the GitHub token for a Copilot API token
          const copilotToken = await getCopilotToken(tokens.access_token, providerId);
          await setProviderAuth(providerId, {
            type: 'oauth',
            accessToken: copilotToken.token,
            // Store GitHub access token as refresh token (used to re-fetch Copilot tokens)
            refreshToken: tokens.access_token,
            expiresAt: copilotToken.expires_at * 1000,
          });
        } finally {
          clearTimeout(timeout);
        }

        pendingAuth.delete(providerId);
        setConnectionStatus(providerId, 'connected');
        return c.json({ success: true });
      }

      return c.json({ error: 'Unknown pending auth state' }, 500);
    } catch (err) {
      pendingAuth.delete(providerId);
      setConnectionStatus(providerId, 'error');
      return c.json({
        error: err instanceof Error ? err.message : 'OAuth flow failed',
      }, 500);
    }
  })

  /**
   * DELETE /:id/oauth -- Remove OAuth credentials and disconnect.
   */
  .delete('/:id/oauth', async (c) => {
    const providerId = c.req.param('id');
    await removeProviderAuth(providerId);
    deleteConnectionStatus(providerId);
    return c.json({ success: true });
  });
