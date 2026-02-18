/**
 * Config loader -- resolves config from all layers.
 *
 * Precedence (later overrides earlier):
 * 1. Built-in defaults
 * 2. Global config (~/.coding-assistant/config.json)
 * 3. Workspace config (<workspace>/.coding-assistant/config.json)
 * 4. Local override (<workspace>/.coding-assistant/config.local.json)
 * 5. Environment variables (ASSISTANT_*)
 * 6. Inline overrides (per-session API params)
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ResolvedConfig, ConfigLayer } from '@coding-assistant/shared';
import {
  CONFIG_DIR_NAME,
  CONFIG_FILE_NAME,
  CONFIG_LOCAL_FILE_NAME,
  ENV_PREFIX,
} from '@coding-assistant/shared';
import { mergeConfigLayers } from './merge.js';
import { defaultConfig } from './defaults.js';
import { validateConfig } from './validator.js';

async function loadJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return await Bun.file(filePath).json();
  } catch {
    return null;
  }
}

function loadEnvConfig(): Partial<ResolvedConfig> {
  const config: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith(ENV_PREFIX) || !value) continue;

    const configKey = key
      .slice(ENV_PREFIX.length)
      .toLowerCase()
      .replace(/_([a-z])/g, (_, c) => c.toUpperCase());

    // Handle nested keys like ASSISTANT_DEFAULT_MODEL -> defaultModel
    if (configKey === 'defaultModel') {
      config.defaultModel = value;
    } else if (configKey.startsWith('provider')) {
      // ASSISTANT_PROVIDER_OPENAI_API_KEY -> providers.openai.apiKey
      const parts = key.slice(ENV_PREFIX.length + 9).toLowerCase().split('_');
      if (parts.length >= 2) {
        const providerId = parts[0];
        const field = parts.slice(1).join('_').replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
        if (!config.providers) config.providers = {};
        const providers = config.providers as Record<string, Record<string, unknown>>;
        if (!providers[providerId]) providers[providerId] = {};
        providers[providerId][field] = value;
      }
    }
  }

  return config as Partial<ResolvedConfig>;
}

export class ConfigLoader {
  /**
   * Resolve the full merged config for a workspace.
   */
  async resolve(
    rootPath: string,
    inlineOverrides?: Partial<ResolvedConfig>,
  ): Promise<ResolvedConfig> {
    const layers: ConfigLayer[] = [
      { source: 'defaults', data: defaultConfig },
    ];

    // Global config
    const globalPath = join(homedir(), CONFIG_DIR_NAME, CONFIG_FILE_NAME);
    const globalData = await loadJsonFile(globalPath);
    if (globalData) {
      layers.push({ source: 'global', path: globalPath, data: globalData as Partial<ResolvedConfig> });
    }

    // Workspace config
    const workspacePath = join(rootPath, CONFIG_DIR_NAME, CONFIG_FILE_NAME);
    const workspaceData = await loadJsonFile(workspacePath);
    if (workspaceData) {
      layers.push({ source: 'workspace', path: workspacePath, data: workspaceData as Partial<ResolvedConfig> });
    }

    // Local override
    const localPath = join(rootPath, CONFIG_DIR_NAME, CONFIG_LOCAL_FILE_NAME);
    const localData = await loadJsonFile(localPath);
    if (localData) {
      layers.push({ source: 'local', path: localPath, data: localData as Partial<ResolvedConfig> });
    }

    // Environment variables
    const envData = loadEnvConfig();
    if (Object.keys(envData).length > 0) {
      layers.push({ source: 'env', data: envData });
    }

    // Inline overrides
    if (inlineOverrides) {
      layers.push({ source: 'inline', data: inlineOverrides });
    }

    const merged = mergeConfigLayers(layers);

    // Validate the final result
    const validation = validateConfig(merged);
    if (!validation.valid) {
      console.warn('Config validation warnings:', validation.errors);
    }

    return merged;
  }
}

export const configLoader = new ConfigLoader();
