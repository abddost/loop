/**
 * Config file watcher -- watches config files and triggers reload.
 */

import { watch, type FSWatcher } from 'chokidar';
import { join } from 'node:path';
import { CONFIG_DIR_NAME, CONFIG_FILE_NAME, CONFIG_LOCAL_FILE_NAME } from '@coding-assistant/shared';

export type ConfigChangeCallback = (changedPath: string) => void;

export class ConfigWatcher {
  private watcher: FSWatcher | null = null;
  private listeners = new Set<ConfigChangeCallback>();

  /**
   * Start watching config files for a workspace.
   */
  start(rootPath: string): void {
    const configDir = join(rootPath, CONFIG_DIR_NAME);
    const watchPaths = [
      join(configDir, CONFIG_FILE_NAME),
      join(configDir, CONFIG_LOCAL_FILE_NAME),
    ];

    this.watcher = watch(watchPaths, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    this.watcher.on('change', (path) => {
      for (const listener of this.listeners) {
        listener(path);
      }
    });
  }

  /**
   * Register a callback for config changes.
   */
  onChange(callback: ConfigChangeCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Stop watching.
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.listeners.clear();
  }
}
