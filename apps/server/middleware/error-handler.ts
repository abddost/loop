/**
 * Global error handler middleware.
 */

import type { ErrorHandler } from 'hono';
import { AppError } from '@coding-assistant/shared';

export const errorHandler: ErrorHandler = (err, c) => {
  console.error(`[${c.get('requestId' as never) ?? 'unknown'}] Error:`, err);

  if (err instanceof AppError) {
    return c.json(err.toJSON(), err.statusCode as 400);
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
