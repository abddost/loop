/**
 * Models routes -- list available models and providers.
 */

import { Hono } from 'hono';
import { modelCatalog, providerRegistry } from '@coding-assistant/core/providers/index.js';
import { readGlobalConfig, updateGlobalConfig } from '../services/global-config.js';
import { parseBody, setDefaultModelSchema, toggleModelSchema } from '../schemas/index.js';

export const modelsRouter = new Hono()
  // List all providers
  .get('/providers', (c) => {
    return c.json({ providers: providerRegistry.list() });
  })

  // Refresh model catalog
  .post('/refresh', async (c) => {
    await modelCatalog.refresh();
    return c.json({ success: true, providers: modelCatalog.listProviders().length });
  })

  // Search for a model
  .get('/search', (c) => {
    const query = c.req.query('q');
    if (!query) {
      return c.json({ error: 'q query param is required' }, 400);
    }

    const model = modelCatalog.findModel(query);
    if (model) {
      return c.json({ model });
    }

    const suggestions = modelCatalog.suggestSimilar(query);
    return c.json({ model: null, suggestions });
  })

  /**
   * GET /grouped -- Models grouped by provider, with connection + enabled state.
   * Connected providers appear first; each group includes its models.
   */
  .get('/grouped', async (c) => {
    if (modelCatalog.needsRefresh) {
      await modelCatalog.refresh();
    }

    const config = await readGlobalConfig();
    const providerConfigs = (config.providers ?? {}) as Record<string, unknown>;
    const enabledModels = new Set(
      Array.isArray(config.enabledModels) ? config.enabledModels as string[] : [],
    );

    const providers = modelCatalog.listProviders();

    const groups = providers.map((p) => ({
      provider: { id: p.id, name: p.name, description: p.description, website: p.website },
      connected: Boolean(providerConfigs[p.id]),
      models: p.models.map((m) => ({
        ...m,
        enabled: enabledModels.has(m.id),
      })),
    }));

    // Connected providers first, then alphabetical
    groups.sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      return a.provider.name.localeCompare(b.provider.name);
    });

    return c.json({ groups });
  })

  /**
   * GET /default -- Returns the current default model from global config.
   */
  .get('/default', async (c) => {
    const config = await readGlobalConfig();
    return c.json({
      defaultModel: config.defaultModel ?? 'openai:gpt-4o',
    });
  })

  /**
   * POST /default -- Sets the default model in global config.
   */
  .post('/default', async (c) => {
    const body = await parseBody(c, setDefaultModelSchema);

    await updateGlobalConfig((config) => {
      config.defaultModel = body.modelId;
    });

    return c.json({ success: true, defaultModel: body.modelId });
  })

  /**
   * POST /toggle -- Enable or disable a model.
   */
  .post('/toggle', async (c) => {
    const body = await parseBody(c, toggleModelSchema);

    await updateGlobalConfig((config) => {
      const enabledModels = new Set(
        Array.isArray(config.enabledModels) ? config.enabledModels as string[] : [],
      );

      if (body.enabled) {
        enabledModels.add(body.modelId);
      } else {
        enabledModels.delete(body.modelId);
      }

      config.enabledModels = Array.from(enabledModels);
    });

    return c.json({ success: true });
  })

  // List all models from catalog (flat)
  .get('/', (c) => {
    const providers = modelCatalog.listProviders();
    const models = providers.flatMap((p) => p.models);
    return c.json({ models, total: models.length });
  });
