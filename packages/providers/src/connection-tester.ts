/**
 * Connection tester -- validates provider credentials by instantiating
 * the SDK client and making a lightweight probe request where possible.
 *
 * Does NOT make an actual LLM completion call (too expensive / slow).
 * Strategy per provider:
 *   - OpenAI / OpenRouter / DeepSeek / OpenAI-compatible: GET /models list
 *   - Others: validate credential completeness + SDK instantiation
 */

import type { ConnectionTestResult, ProviderConfig } from '@coding-assistant/shared';
import { providerRegistry } from './registry.js';
import { getCredentialSchema } from './credential-schema.js';

/** Timeout for the probe request (ms) */
const PROBE_TIMEOUT_MS = 10_000;

/**
 * Providers that expose an OpenAI-compatible /models endpoint.
 * For these we can make a real lightweight API call to validate the key.
 */
const PROBEABLE_PROVIDERS = new Set([
  'openai',
  'openrouter',
  'deepseek',
  'openai-compatible',
]);

/**
 * Base URLs used when probing /models (only for providers with known base URLs).
 */
const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  deepseek: 'https://api.deepseek.com/v1',
};

/**
 * Test whether the given credentials can successfully connect to a provider.
 */
export async function testProviderConnection(
  providerId: string,
  credentials: Record<string, string>,
): Promise<ConnectionTestResult> {
  const start = Date.now();

  try {
    // 1. Validate required fields are present
    const schema = getCredentialSchema(providerId);
    const missingFields = schema
      .filter((f) => f.required && !credentials[f.key]?.trim())
      .map((f) => f.label);

    if (missingFields.length > 0) {
      return {
        success: false,
        providerId,
        errorMessage: `Missing required fields: ${missingFields.join(', ')}`,
      };
    }

    // 2. Build a ProviderConfig from the flat credentials record
    const config = credentialsToProviderConfig(providerId, credentials);

    // 3. Attempt to instantiate the SDK provider (validates config shape).
    //    Skip if the provider has no registered adapter -- we can still
    //    validate via the /models probe for OpenAI-compatible providers.
    const hasAdapter = providerRegistry.list().includes(providerId);
    if (hasAdapter) {
      providerRegistry.getProvider(providerId, config);
    }

    // 4. If the provider supports it, make a lightweight /models probe
    if (PROBEABLE_PROVIDERS.has(providerId)) {
      const probeResult = await probeModelsEndpoint(providerId, credentials);
      return {
        success: probeResult.success,
        providerId,
        latencyMs: Date.now() - start,
        errorMessage: probeResult.errorMessage,
        modelsAvailable: probeResult.modelsAvailable,
      };
    }

    // 5. For non-probeable providers, successful instantiation is enough
    return {
      success: true,
      providerId,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      providerId,
      latencyMs: Date.now() - start,
      errorMessage: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a flat credentials record into a ProviderConfig.
 */
function credentialsToProviderConfig(
  providerId: string,
  credentials: Record<string, string>,
): ProviderConfig {
  const { apiKey, baseUrl, ...rest } = credentials;

  // Collect non-standard fields into options
  const options: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v) options[k] = v;
  }

  return {
    id: providerId,
    apiKey: apiKey || undefined,
    baseUrl: baseUrl || undefined,
    options: Object.keys(options).length > 0 ? options : undefined,
  };
}

/**
 * Probe a provider's /models endpoint to validate the API key.
 */
async function probeModelsEndpoint(
  providerId: string,
  credentials: Record<string, string>,
): Promise<{ success: boolean; errorMessage?: string; modelsAvailable?: number }> {
  const baseUrl = credentials.baseUrl || PROVIDER_BASE_URLS[providerId];
  if (!baseUrl) {
    // No base URL to probe -- treat as valid
    return { success: true };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${credentials.apiKey ?? ''}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        return { success: false, errorMessage: 'Invalid API key or unauthorized' };
      }
      return {
        success: false,
        errorMessage: `API returned ${res.status}: ${body.slice(0, 200)}`,
      };
    }

    const data = await res.json().catch(() => null);
    const modelsAvailable = Array.isArray(data?.data) ? data.data.length : undefined;

    return { success: true, modelsAvailable };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, errorMessage: 'Connection timed out' };
    }
    return {
      success: false,
      errorMessage: err instanceof Error ? err.message : 'Connection failed',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export { credentialsToProviderConfig };
