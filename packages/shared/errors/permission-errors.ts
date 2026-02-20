import { AppError } from './base.js';

/**
 * Base permission error.
 */
export class PermissionError extends AppError {
  public readonly toolName: string;

  constructor(toolName: string, message: string) {
    super(message, 'PERMISSION_DENIED', 403);
    this.name = 'PermissionError';
    this.toolName = toolName;
  }
}

/**
 * Permission denied by a config rule (hard deny — tool never runs).
 */
export class PermissionDeniedError extends PermissionError {
  constructor(toolName: string, reason?: string) {
    super(toolName, reason ?? `Permission denied for ${toolName}`);
    this.name = 'PermissionDeniedError';
  }
}

/**
 * Permission request timed out (user did not respond in time).
 */
export class PermissionTimeoutError extends PermissionError {
  constructor(toolName: string) {
    super(toolName, `Permission request timed out for ${toolName}`);
    this.name = 'PermissionTimeoutError';
  }
}

/**
 * User explicitly rejected the permission.
 */
export class PermissionRejectedError extends PermissionError {
  public readonly feedback?: string;

  constructor(toolName: string, feedback?: string) {
    super(toolName, feedback ?? `User rejected permission for ${toolName}`);
    this.name = 'PermissionRejectedError';
    this.feedback = feedback;
  }
}
