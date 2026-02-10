import { AppError } from './base.js';

export class ProviderError extends AppError {
  public readonly providerId: string;

  constructor(providerId: string, message: string, code: string = 'PROVIDER_ERROR') {
    super(message, code, 502);
    this.name = 'ProviderError';
    this.providerId = providerId;
  }
}

export class ProviderNotFoundError extends ProviderError {
  constructor(providerId: string) {
    super(providerId, `Provider not found: ${providerId}`, 'PROVIDER_NOT_FOUND');
    this.name = 'ProviderNotFoundError';
  }
}

export class ModelNotFoundError extends ProviderError {
  constructor(modelId: string) {
    super('unknown', `Model not found: ${modelId}`, 'MODEL_NOT_FOUND');
    this.name = 'ModelNotFoundError';
  }
}

export class ProviderAuthError extends ProviderError {
  constructor(providerId: string) {
    super(providerId, `Authentication failed for provider: ${providerId}`, 'PROVIDER_AUTH_ERROR');
    this.name = 'ProviderAuthError';
  }
}

export class ProviderRateLimitError extends ProviderError {
  public readonly retryAfterMs?: number;

  constructor(providerId: string, retryAfterMs?: number) {
    super(providerId, `Rate limited by provider: ${providerId}`, 'PROVIDER_RATE_LIMIT');
    this.name = 'ProviderRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}
