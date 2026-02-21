/**
 * grep tool -- searches file contents using regex.
 */

import { z } from 'zod';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { ToolDefinition } from '../types.js';
import { assertExternalDirectory } from '../assert-external-directory.js';

const inputSchema = z.object({
  pattern: z.string().describe('Regex pattern to search for'),
  path: z.string().optional().describe('Directory or file to search in (relative to workspace root)'),
  glob: z.string().optional().describe('File glob pattern to filter (e.g., "*.ts")'),
  caseSensitive: z.boolean().optional().default(true),
  maxResults: z.number().optional().default(50),
});

type Input = z.infer<typeof inputSchema>;

interface Match {
  file: string;
  line: number;
  content: string;
}

async function searchFile(
  filePath: string,
  regex: RegExp,
  rootPath: string,
  maxResults: number,
): Promise<Match[]> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const matches: Match[] = [];
    const rel = relative(rootPath, filePath);

    for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
      if (regex.test(lines[i])) {
        matches.push({ file: rel, line: i + 1, content: lines[i].trim() });
      }
    }
    return matches;
  } catch {
    return [];
  }
}

async function walkDir(dir: string, glob?: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await walkDir(fullPath, glob)));
    } else if (entry.isFile()) {
      if (glob) {
        const ext = '.' + entry.name.split('.').pop();
        const globExt = glob.startsWith('*') ? glob.slice(1) : glob;
        if (!ext.endsWith(globExt)) continue;
      }
      files.push(fullPath);
    }
  }
  return files;
}

export const definition: ToolDefinition<Input, string> = {
  name: 'grep',
  description: 'Search file contents using regex patterns',
  inputSchema,
  category: 'search',
  riskLevel: 'safe',

  async execute(input, ctx) {
    const searchPath = input.path
      ? join(ctx.workspaceRootPath, input.path)
      : ctx.workspaceRootPath;

    await ctx.ask({
      permission: 'grep',
      patterns: [input.pattern],
      always: ['*'],
      metadata: {
        toolName: 'grep',
        pattern: input.pattern,
        path: input.path,
        glob: input.glob,
      },
    });

    await assertExternalDirectory(ctx, searchPath, { kind: 'directory' });

    const flags = input.caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(input.pattern, flags);

    const fileStat = await stat(searchPath);
    let allMatches: Match[] = [];

    if (fileStat.isFile()) {
      allMatches = await searchFile(searchPath, regex, ctx.workspaceRootPath, input.maxResults);
    } else {
      const files = await walkDir(searchPath, input.glob);
      for (const file of files) {
        if (allMatches.length >= input.maxResults) break;
        const matches = await searchFile(file, regex, ctx.workspaceRootPath, input.maxResults - allMatches.length);
        allMatches.push(...matches);
      }
    }

    if (allMatches.length === 0) {
      return { result: 'No matches found.' };
    }

    const output = allMatches
      .map((m) => `${m.file}:${m.line}: ${m.content}`)
      .join('\n');

    return {
      result: output,
      metadata: { matchCount: allMatches.length },
    };
  },
};
