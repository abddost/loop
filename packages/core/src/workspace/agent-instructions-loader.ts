/**
 * Loads AGENTS.md files from the workspace directory.
 */

import { readFile, access } from 'node:fs/promises';
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
      await access(filePath);
      const content = await readFile(filePath, 'utf-8');
      if (content.trim()) {
        instructions.push(content.trim());
      }
    } catch {
      // File doesn't exist, skip
    }
  }

  return instructions;
}
