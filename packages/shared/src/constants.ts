/** Application-wide constants */

export const APP_NAME = 'coding-assistant';
export const APP_VERSION = '0.1.0';

/** Config file names */
export const CONFIG_DIR_NAME = '.coding-assistant';
export const CONFIG_FILE_NAME = 'config.json';
export const CONFIG_LOCAL_FILE_NAME = 'config.local.json';
export const AGENTS_MD_FILE_NAME = 'AGENTS.md';

/** Config paths */
export const GLOBAL_CONFIG_DIR = `~/${CONFIG_DIR_NAME}`;

/** Environment variable prefix */
export const ENV_PREFIX = 'ASSISTANT_';

/** Default model */
export const DEFAULT_MODEL_ID = 'openai:gpt-4o';

/** Execution limits */
export const DEFAULT_MAX_STEPS = 25;
export const DEFAULT_MAX_OUTPUT_TOKENS = 16384;
export const CONTEXT_BUDGET_RATIO = 0.85;

/** Server defaults */
export const DEFAULT_SERVER_HOST = '127.0.0.1';
export const DEFAULT_SERVER_PORT = 7878;

/** Database */
export const DATABASE_FILE_NAME = 'assistant.db';

/** SSE */
export const SSE_KEEPALIVE_INTERVAL_MS = 30_000;
export const SSE_RECONNECT_DELAY_MS = 1_000;
