/**
 * Zod schemas for request body validation.
 *
 * Each schema corresponds to a POST/PUT endpoint in the server routes.
 * Use `parseBody(c, schema)` in route handlers to validate and parse
 * the request body, throwing a ValidationError on failure.
 */

import { z } from 'zod';
import type { Context } from 'hono';
import { ValidationError } from '@coding-assistant/shared';

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

/**
 * Parse and validate a JSON request body against a Zod schema.
 * Throws ValidationError (400) if validation fails.
 */
export async function parseBody<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<z.infer<T>> {
  const body = await c.req.json();
  const result = schema.safeParse(body);

  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new ValidationError(`Invalid request body: ${issues.join('; ')}`, result.error.issues);
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// Session schemas
// ---------------------------------------------------------------------------

export const createSessionSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  agentId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Message schemas
// ---------------------------------------------------------------------------

export const sendMessageSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  sessionId: z.string().min(1, 'sessionId is required'),
  content: z.string().min(1, 'content is required'),
  model: z.string().optional(),
  messageId: z.string().optional(),
  agentId: z.string().optional(),
  effort: z.string().optional(),
  hidden: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Workspace schemas
// ---------------------------------------------------------------------------

export const openWorkspaceSchema = z.object({
  rootPath: z.string().min(1, 'rootPath is required'),
});

// ---------------------------------------------------------------------------
// Model schemas
// ---------------------------------------------------------------------------

export const setDefaultModelSchema = z.object({
  modelId: z.string().min(1, 'modelId is required'),
});

export const toggleModelSchema = z.object({
  modelId: z.string().min(1, 'modelId is required'),
  enabled: z.boolean(),
});

// ---------------------------------------------------------------------------
// Provider schemas
// ---------------------------------------------------------------------------

export const connectProviderSchema = z.object({
  credentials: z.record(z.string(), z.string()).refine(
    (creds) => Object.keys(creds).length > 0,
    'credentials must have at least one entry',
  ),
});

// ---------------------------------------------------------------------------
// Permission schemas
// ---------------------------------------------------------------------------

export const permissionResponseSchema = z.object({
  requestId: z.string().min(1, 'requestId is required'),
  granted: z.boolean(),
});
