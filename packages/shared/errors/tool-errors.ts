import { AppError } from './base.js';

export class ToolError extends AppError {
  public readonly toolName: string;

  constructor(toolName: string, message: string, code: string = 'TOOL_ERROR') {
    super(message, code, 500);
    this.name = 'ToolError';
    this.toolName = toolName;
  }
}

export class ToolNotFoundError extends ToolError {
  constructor(toolName: string) {
    super(toolName, `Tool not found: ${toolName}`, 'TOOL_NOT_FOUND');
    this.name = 'ToolNotFoundError';
  }
}

export class ToolExecutionError extends ToolError {
  constructor(toolName: string, message: string, details?: unknown) {
    super(toolName, message, 'TOOL_EXECUTION_ERROR');
    this.name = 'ToolExecutionError';
    this.details = details;
  }

  // Override to allow setting details
  declare details: unknown;
}

export class ToolValidationError extends ToolError {
  constructor(toolName: string, message: string, details?: unknown) {
    super(toolName, message, 'TOOL_VALIDATION_ERROR');
    this.name = 'ToolValidationError';
    this.details = details;
  }

  declare details: unknown;
}

export class ToolTimeoutError extends ToolError {
  constructor(toolName: string, timeoutMs: number) {
    super(toolName, `Tool ${toolName} timed out after ${timeoutMs}ms`, 'TOOL_TIMEOUT');
    this.name = 'ToolTimeoutError';
  }
}
