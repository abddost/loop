/**
 * Provider routes -- global provider management (no workspaceId).
 *
 * Provider credentials are user-level and stored in the global config
 * (~/.coding-assistant/config.json), not scoped to any workspace.
 */

import { Hono } from 'hono';
import type { ProviderCatalogEntry } from '@coding-assistant/shared';
import {
  modelCatalog,
  getCredentialSchema,
  testProviderConnection,
  credentialsToProviderConfig,
} from '@coding-assistant/core/providers/index.js';
import {
  readGlobalConfig,
  writeGlobalConfig,
  getConnectionStatuses,
  getConnectionStatus,
  setConnectionStatus,
  deleteConnectionStatus,
} from '../services/global-config.js';
import { parseBody, connectProviderSchema } from '../schemas/index.js';

export const providersRouter = new Hono()
  /**
   * GET / -- List all providers segmented into connected, popular, other.
   */
  .get('/', async (c) => {
    const config = await readGlobalConfig();
    const providerConfigs = config.providers ?? {};

    // Build status map from cache
    const statuses = getConnectionStatuses(Object.keys(providerConfigs));

    // Ensure catalog is loaded
    if (modelCatalog.needsRefresh) {
      await modelCatalog.refresh();
    }

    const entries = modelCatalog.getProviderCatalogEntries(providerConfigs, statuses);

    // Segment for the UI
    const connected: ProviderCatalogEntry[] = [];
    const popular: ProviderCatalogEntry[] = [];
    const other: ProviderCatalogEntry[] = [];

    for (const entry of entries) {
      if (entry.connectionStatus === 'connected' || entry.connectionStatus === 'untested') {
        // Has credentials saved
        if (providerConfigs[entry.id]) {
          connected.push(entry);
          continue;
        }
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
    const config = await readGlobalConfig();
    const providerConfigs = config.providers ?? {};
    const statuses = providerConfigs[providerId]
      ? { [providerId]: getConnectionStatus(providerId) }
      : {};

    if (modelCatalog.needsRefresh) {
      await modelCatalog.refresh();
    }

    const entries = modelCatalog.getProviderCatalogEntries(providerConfigs, statuses);
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

    if (config.providers?.[providerId]) {
      delete config.providers[providerId];
      await writeGlobalConfig(config);
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

    if (!providerEntry) {
      return c.json({
        success: false,
        providerId,
        errorMessage: 'Provider not configured. Connect it first.',
      }, 400);
    }

    // Rebuild credentials from stored config
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
  });
