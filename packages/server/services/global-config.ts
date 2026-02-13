/**
 * GlobalConfigService -- single source of truth for reading/writing the
 * user-level global config file (~/.coding-assistant/config.json).
 *
 * Also provides a **unified credential source** that merges API-key
 * credentials from config.json with OAuth tokens from auth.json so every
 * consumer (routes, execution loop) sees the full set of connected providers.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { CONFIG_DIR_NAME, CONFIG_FILE_NAME } from '@coding-assistant/shared';
import type { ProviderConfigEntry, ProviderConnectionStatus } from '@coding-assistant/shared';
import {
  readAuthStore,
  isTokenExpired,
} from '@coding-assistant/core/auth/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GlobalConfigData {
  defaultModel?: string;
  providers?: Record<string, ProviderConfigEntry>;
  enabledModels?: string[];
  [key: string]: unknown;
}

/**
 * Unified view of all connected providers, merging API-key credentials
 * (config.json) with OAuth tokens (auth.json).
 */
export interface ConnectedProviderInfo {
  /** API-key entries from config.json, keyed by provider id. */
  configProviders: Record<string, ProviderConfigEntry>;
  /** Provider ids that are authenticated via OAuth (auth.json). */
  oauthProviderIds: Set<string>;
  /** Union of config and OAuth provider ids -- every "connected" provider. */
  allConnectedIds: Set<string>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const GLOBAL_CONFIG_PATH = join(homedir(), CONFIG_DIR_NAME, CONFIG_FILE_NAME);

/** Connection status cache (in-memory, per server lifetime). */
const connectionStatusCache = new Map<string, ProviderConnectionStatus>();

/** Whether we have already hydrated OAuth statuses into the cache. */
let oauthStatusesHydrated = false;

export async function readGlobalConfig(): Promise<GlobalConfigData> {
  try {
    const raw = await readFile(GLOBAL_CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as GlobalConfigData;
  } catch {
    return {};
  }
}

export async function writeGlobalConfig(data: GlobalConfigData): Promise<void> {
  const dir = join(homedir(), CONFIG_DIR_NAME);
  await mkdir(dir, { recursive: true });
  await writeFile(GLOBAL_CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Read-modify-write helper that avoids race conditions from separate
 * readGlobalConfig() + writeGlobalConfig() calls in route handlers.
 */
export async function updateGlobalConfig(
  updater: (config: GlobalConfigData) => GlobalConfigData | void,
): Promise<GlobalConfigData> {
  const config = await readGlobalConfig();
  const result = updater(config);
  const updated = result ?? config; // updater can mutate in place or return new object
  await writeGlobalConfig(updated);
  return updated;
}

// ---------------------------------------------------------------------------
// Unified credential source
// ---------------------------------------------------------------------------

/**
 * Merge both credential stores into a single view of connected providers.
 *
 * - `configProviders` -- API-key entries from `config.json`
 * - `oauthProviderIds` -- providers with tokens in `auth.json`
 * - `allConnectedIds` -- union of both
 *
 * Also performs one-time hydration of the connection-status cache so OAuth
 * providers with valid tokens start as `'connected'` instead of `'untested'`.
 */
export async function getConnectedProviderIds(): Promise<ConnectedProviderInfo> {
  const config = await readGlobalConfig();
  const configProviders = config.providers ?? {};
  const authStore = await readAuthStore();

  const oauthProviderIds = new Set(Object.keys(authStore));
  const allConnectedIds = new Set([
    ...Object.keys(configProviders),
    ...oauthProviderIds,
  ]);

  // Hydrate connection-status cache for OAuth providers on first call.
  // This ensures that after a server restart OAuth providers don't show
  // as "untested" / "disconnected" when they hold valid tokens.
  if (!oauthStatusesHydrated) {
    for (const [id, auth] of Object.entries(authStore)) {
      if (!connectionStatusCache.has(id)) {
        connectionStatusCache.set(
          id,
          isTokenExpired(auth) ? 'untested' : 'connected',
        );
      }
    }
    oauthStatusesHydrated = true;
  }

  return { configProviders, oauthProviderIds, allConnectedIds };
}

// ---------------------------------------------------------------------------
// Connection status cache accessors
// ---------------------------------------------------------------------------

export function getConnectionStatus(providerId: string): ProviderConnectionStatus {
  return connectionStatusCache.get(providerId) ?? 'untested';
}

export function setConnectionStatus(providerId: string, status: ProviderConnectionStatus): void {
  connectionStatusCache.set(providerId, status);
}

export function deleteConnectionStatus(providerId: string): void {
  connectionStatusCache.delete(providerId);
}

export function getConnectionStatuses(providerIds: string[]): Record<string, ProviderConnectionStatus> {
  const statuses: Record<string, ProviderConnectionStatus> = {};
  for (const id of providerIds) {
    statuses[id] = connectionStatusCache.get(id) ?? 'untested';
  }
  return statuses;
}
