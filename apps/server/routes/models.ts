/**
 * Models routes -- list available models and providers.
 */

import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { CONFIG_DIR_NAME, CONFIG_FILE_NAME } from '@coding-assistant/shared';
import { modelCatalog, providerRegistry } from '@coding-assistant/providers';

/** Read global config for enabled models / provider connection info. */
async function readGlobalConfig(): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(join(homedir(), CONFIG_DIR_NAME, CONFIG_FILE_NAME), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

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
   * POST /toggle -- Enable or disable a model.
   */
  .post('/toggle', async (c) => {
    const body = await c.req.json<{ modelId: string; enabled: boolean }>();
    if (!body.modelId || typeof body.enabled !== 'boolean') {
      return c.json({ error: 'modelId and enabled are required' }, 400);
    }

    const config = await readGlobalConfig();
    const enabledModels = new Set(
      Array.isArray(config.enabledModels) ? config.enabledModels as string[] : [],
    );

    if (body.enabled) {
      enabledModels.add(body.modelId);
    } else {
      enabledModels.delete(body.modelId);
    }

    config.enabledModels = Array.from(enabledModels);

    // Write back
    const { writeFile, mkdir } = await import('node:fs/promises');
    const dir = join(homedir(), CONFIG_DIR_NAME);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(homedir(), CONFIG_DIR_NAME, CONFIG_FILE_NAME),
      JSON.stringify(config, null, 2),
      'utf-8',
    );

    return c.json({ success: true });
  })

  // List all models from catalog (flat)
  .get('/', (c) => {
    const providers = modelCatalog.listProviders();
    const models = providers.flatMap((p) => p.models);
    return c.json({ models, total: models.length });
  });
