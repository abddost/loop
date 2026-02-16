/**
 * plan-save tool -- persists a plan to disk.
 *
 * Saves plans to `~/.coding-assistant/plans/{slug}-{timestamp}.md`.
 * Optionally copies to the workspace at `{workspaceRoot}/.coding-assistant/plans/`.
 */

import { z } from 'zod';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ToolDefinition } from '../types.js';

const PLANS_DIR = join(homedir(), '.coding-assistant', 'plans');

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

const inputSchema = z.object({
  title: z.string().describe('Plan title'),
  content: z.string().describe('Full plan content in markdown'),
    saveToWorkspace: z.boolean().optional().describe('Also save a copy to the workspace'),
});

type Input = z.infer<typeof inputSchema>;

export const definition: ToolDefinition<Input> = {
  name: 'plan-save',
  description: 'Save a plan to persistent storage. Plans are saved as markdown files and can be viewed later.',
  inputSchema,
  category: 'task',
  riskLevel: 'safe',

  async execute(input, ctx) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const slug = slugify(input.title);
    const filename = `${slug}-${timestamp}.md`;

    // Build markdown with frontmatter
    const markdown = [
      '---',
      `title: "${input.title.replace(/"/g, '\\"')}"`,
      `created: "${new Date().toISOString()}"`,
      `workspace: "${ctx.workspaceId}"`,
      '---',
      '',
      input.content,
    ].join('\n');

    // Save to global plans directory
    await mkdir(PLANS_DIR, { recursive: true });
    const globalPath = join(PLANS_DIR, filename);
    await writeFile(globalPath, markdown, 'utf-8');

    const paths = [globalPath];

    // Optionally save to workspace
    if (input.saveToWorkspace && ctx.workspaceRootPath) {
      const wsPlansDir = join(ctx.workspaceRootPath, '.coding-assistant', 'plans');
      await mkdir(wsPlansDir, { recursive: true });
      const wsPath = join(wsPlansDir, filename);
      await writeFile(wsPath, markdown, 'utf-8');
      paths.push(wsPath);
    }

    const planId = `${slug}-${timestamp}`;

    return {
      result: {
        text: `Plan saved: ${paths.join(', ')}`,
        planId,
        filename,
        title: input.title,
        paths,
        savedToWorkspace: input.saveToWorkspace,
      },
    };
  },
};
