/**
 * Loads AGENTS.md files from the workspace directory.
 */

import { join } from 'node:path';
import { AGENTS_MD_FILE_NAME, CONFIG_DIR_NAME } from '@coding-assistant/shared';

/**
 * Load agent instructions from AGENTS.md files in the workspace.
 * Checks both the workspace root and the config directory.
 */
export async function loadAgentInstructions(rootPath: string): Promise<string[]> {
  const instructions: string[] = [];
  const candidates = [
    join(rootPath, AGENTS_MD_FILE_NAME),
    join(rootPath, CONFIG_DIR_NAME, AGENTS_MD_FILE_NAME),
  ];

  for (const filePath of candidates) {
    try {
      const file = Bun.file(filePath);
      if (await file.exists()) {
        const content = await file.text();
        if (content.trim()) {
          instructions.push(content.trim());
        }
      }
    } catch {
      // File doesn't exist, skip
    }
  }

  return instructions;
}
