/**
 * Default permission rules for all agents.
 *
 * These sensible defaults cover:
 *   - Everything inside workspace → allowed
 *   - Doom loop detection → ask
 *   - Paths outside workspace → ask
 *   - .env files → ask (security)
 */

import { Permission } from './permission.js';

export const defaultPermissionRules: Permission.Ruleset = Permission.fromConfig({
  '*': 'allow',
  doom_loop: 'ask',
  external_directory: {
    '*': 'ask',
  },
  read: {
    '*': 'allow',
    '*.env': 'ask',
    '*.env.*': 'ask',
    '*.env.example': 'allow',
  },
});
