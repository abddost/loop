/**
 * web-search tool -- searches the web for information.
 */

import { z } from 'zod';
import type { ToolDefinition } from '../types.js';

const inputSchema = z.object({
  query: z.string().describe('Search query'),
  maxResults: z.number().optional().default(5).describe('Maximum number of results'),
});

type Input = z.infer<typeof inputSchema>;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export const definition: ToolDefinition<Input, SearchResult[]> = {
  name: 'web-search',
  description: 'Search the web for real-time information',
  inputSchema,
  category: 'web',
  riskLevel: 'moderate',

  async execute(input, _ctx) {
    // Placeholder -- in production, this would integrate with a search API
    // (e.g., Brave Search, Tavily, etc.)
    return {
      result: [{
        title: 'Web search placeholder',
        url: 'https://example.com',
        snippet: `Search results for: ${input.query} (integration pending)`,
      }],
      metadata: {
        query: input.query,
        provider: 'placeholder',
      },
    };
  },
};
