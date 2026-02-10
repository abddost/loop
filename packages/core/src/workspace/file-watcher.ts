/**
 * Workspace-scoped filesystem watcher.
 */

import { watch, type FSWatcher } from 'chokidar';
import type { ResolvedConfig } from '@coding-assistant/shared';

export type FileChangeEvent = {
  type: 'add' | 'change' | 'unlink';
  path: string;
};

export type FileChangeCallback = (event: FileChangeEvent) => void;

export function createFileWatcher(
  rootPath: string,
  _config: ResolvedConfig,
): FSWatcher {
  return watch(rootPath, {
    ignored: [
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/*.db',
      '**/*.db-journal',
      '**/*.db-wal',
    ],
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  });
}
