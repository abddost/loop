/**
 * Global error handler middleware.
 *
 * Catches all errors thrown in route handlers and maps them to
 * structured JSON responses. AppError subclasses (NotFoundError,
 * ValidationError, etc.) carry their own status codes.
 */

import type { ErrorHandler } from 'hono';
import { AppError } from '@coding-assistant/shared';
import type { AppEnv } from '../app.js';

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const requestId = c.get('requestId') ?? 'unknown';
  console.error(`[${requestId}] Error:`, err);

  if (err instanceof AppError) {
    // Hono's StatusCode type is a union of literal numbers.
    // The cast is safe because AppError.statusCode is always a valid HTTP status.
    return c.json(
      err.toJSON(),
      err.statusCode as Parameters<typeof c.json>[1] & number,
    );
  }

  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: err.message ?? 'Internal server error',
      },
    },
    500,
  );
};
