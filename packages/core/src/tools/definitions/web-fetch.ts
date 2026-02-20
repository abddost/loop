/**
 * web-fetch tool -- fetches content from a URL.
 */

import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  url: z.string().url().describe('The URL to fetch'),
  maxLength: z.number().optional().default(50000).describe('Maximum response length in characters'),
});

type Input = z.infer<typeof inputSchema>;

export const definition: ToolDefinition<Input, string> = {
  name: 'web-fetch',
  description: 'Fetch content from a URL',
  inputSchema,
  category: 'web',
  riskLevel: 'moderate',

  async execute(input, ctx) {
    await ctx.ask({
      permission: 'webfetch',
      patterns: [input.url],
      always: ['*'],
      metadata: { toolName: 'web-fetch', url: input.url },
    });

    const response = await fetch(input.url, {
      signal: ctx.abort,
      headers: {
        'User-Agent': 'CodingAssistant/0.1',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    let content = await response.text();
    if (content.length > input.maxLength) {
      content = content.slice(0, input.maxLength) + '\n... (truncated)';
    }

    return {
      result: content,
      metadata: {
        status: response.status,
        contentType: response.headers.get('content-type'),
        contentLength: content.length,
      },
    };
  },
};
