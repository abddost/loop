/**
 * Plan routes -- list and read persisted plans.
 */

import { Hono } from 'hono';
import { readdir, readFile, copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { resolveWorkspace } from '../helpers/resolve.js';

const PLANS_DIR = join(homedir(), '.coding-assistant', 'plans');

export const plansRouter = new Hono()

  /**
   * GET /api/plans
   * List all saved plans (most recent first).
   */
  .get('/', async (c) => {
    try {
      await mkdir(PLANS_DIR, { recursive: true });
      const files = await readdir(PLANS_DIR);
      const plans = files
        .filter((f) => f.endsWith('.md'))
        .sort((a, b) => b.localeCompare(a)) // Most recent first (timestamp in filename)
        .map((filename) => {
          // Extract plan ID (filename without .md)
          const planId = filename.replace(/\.md$/, '');
          return { planId, filename };
        });

      return c.json({ plans });
    } catch {
      return c.json({ plans: [] });
    }
  })

  /**
   * GET /api/plans/:planId
   * Read a specific plan's content.
   */
  .get('/:planId', async (c) => {
    const planId = c.req.param('planId');
    const filePath = join(PLANS_DIR, `${planId}.md`);

    try {
      const content = await readFile(filePath, 'utf-8');

      // Parse frontmatter
      let title = planId;
      let created = '';
      let workspace = '';
      let body = content;

      const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (fmMatch) {
        const fm = fmMatch[1];
        body = fmMatch[2].trimStart();
        const titleMatch = fm.match(/title:\s*"(.+?)"/);
        const createdMatch = fm.match(/created:\s*"(.+?)"/);
        const wsMatch = fm.match(/workspace:\s*"(.+?)"/);
        if (titleMatch) title = titleMatch[1];
        if (createdMatch) created = createdMatch[1];
        if (wsMatch) workspace = wsMatch[1];
      }

      return c.json({ planId, title, created, workspace, content: body });
    } catch {
      return c.json({ error: { message: `Plan "${planId}" not found` } }, 404);
    }
  })

  /**
   * POST /api/plans/:planId/save-to-workspace
   * Copy a plan to a workspace's local directory.
   * Body: { workspaceId: string }
   */
  .post('/:planId/save-to-workspace', async (c) => {
    const planId = c.req.param('planId');
    const body = await c.req.json();
    const { workspaceId } = body;

    const workspace = resolveWorkspace(workspaceId);

    const srcPath = join(PLANS_DIR, `${planId}.md`);
    const destDir = join(workspace.rootPath, '.coding-assistant', 'plans');
    await mkdir(destDir, { recursive: true });
    const destPath = join(destDir, `${planId}.md`);

    try {
      await copyFile(srcPath, destPath);
      return c.json({ success: true, path: destPath });
    } catch {
      return c.json({ error: { message: `Plan "${planId}" not found` } }, 404);
    }
  });
