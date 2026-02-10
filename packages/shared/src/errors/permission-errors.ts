import { AppError } from './base.js';

export class PermissionError extends AppError {
  public readonly domain: string;
  public readonly toolName: string;

  constructor(toolName: string, domain: string, message: string) {
    super(message, 'PERMISSION_DENIED', 403);
    this.name = 'PermissionError';
    this.domain = domain;
    this.toolName = toolName;
  }
}

export class PermissionDeniedError extends PermissionError {
  constructor(toolName: string, domain: string, reason?: string) {
    super(
      toolName,
      domain,
      reason ?? `Permission denied for ${toolName} in domain ${domain}`,
    );
    this.name = 'PermissionDeniedError';
  }
}

export class PermissionTimeoutError extends PermissionError {
  constructor(toolName: string, domain: string) {
    super(toolName, domain, `Permission request timed out for ${toolName}`);
    this.name = 'PermissionTimeoutError';
  }
}
