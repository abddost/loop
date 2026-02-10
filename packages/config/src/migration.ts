/**
 * Config migration utilities -- handles upgrading old config formats.
 */

export interface ConfigMigration {
  fromVersion: number;
  toVersion: number;
  migrate: (config: Record<string, unknown>) => Record<string, unknown>;
}

const migrations: ConfigMigration[] = [
  // Example migration: v0 -> v1
  {
    fromVersion: 0,
    toVersion: 1,
    migrate: (config) => {
      // Rename old fields if they exist
      const result = { ...config };
      if ('model' in result && !('defaultModel' in result)) {
        result.defaultModel = result.model;
        delete result.model;
      }
      result._configVersion = 1;
      return result;
    },
  },
];

export function getConfigVersion(config: Record<string, unknown>): number {
  return typeof config._configVersion === 'number' ? config._configVersion : 0;
}

export function migrateConfig(config: Record<string, unknown>): Record<string, unknown> {
  let current = { ...config };
  let version = getConfigVersion(current);

  for (const migration of migrations) {
    if (version === migration.fromVersion) {
      current = migration.migrate(current);
      version = migration.toVersion;
    }
  }

  return current;
}
