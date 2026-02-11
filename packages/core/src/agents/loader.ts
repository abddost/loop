/**
 * AGENTS.md loader -- loads agent instructions from workspace.
 * Called during WorkspaceContext creation.
 */

import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentInstructions } from '@coding-assistant/shared';

const AGENTS_FILES = ['AGENTS.md', '.coding-assistant/AGENTS.md'];

/**
 * Load all AGENTS.md files from a workspace directory.
 */
export async function loadAgentInstructionsFromWorkspace(
  rootPath: string,
): Promise<AgentInstructions[]> {
  const instructions: AgentInstructions[] = [];

  for (const relPath of AGENTS_FILES) {
    const fullPath = join(rootPath, relPath);
    try {
      await access(fullPath);
      const content = await readFile(fullPath, 'utf-8');
      if (content.trim()) {
        instructions.push({
          content: content.trim(),
          source: fullPath,
        });
      }
    } catch {
      // File doesn't exist, skip
    }
  }

  return instructions;
}
