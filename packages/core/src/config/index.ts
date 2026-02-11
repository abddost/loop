export { configSchema, type ConfigSchema } from './schema.js';
export { configLoader, ConfigLoader } from './loader.js';
export { mergeConfigLayers } from './merge.js';
export { validateConfig, type ValidationResult } from './validator.js';
export { ConfigWatcher, type ConfigChangeCallback } from './watcher.js';
export { migrateConfig, getConfigVersion, type ConfigMigration } from './migration.js';
export { defaultConfig } from './defaults.js';
