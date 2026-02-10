/**
 * GlobalConfigService -- single source of truth for reading/writing the
 * user-level global config file (~/.coding-assistant/config.json).
 *
 * Replaces the duplicated readGlobalConfig() / writeGlobalConfig() helpers
 * that previously lived in both routes/models.ts and routes/providers.ts.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { CONFIG_DIR_NAME, CONFIG_FILE_NAME } from '@coding-assistant/shared';
import type { ProviderConfigEntry, ProviderConnectionStatus } from '@coding-assistant/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GlobalConfigData {
  defaultModel?: string;
  providers?: Record<string, ProviderConfigEntry>;
  enabledModels?: string[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const GLOBAL_CONFIG_PATH = join(homedir(), CONFIG_DIR_NAME, CONFIG_FILE_NAME);

/** Connection status cache (in-memory, per server lifetime). */
const connectionStatusCache = new Map<string, ProviderConnectionStatus>();

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
