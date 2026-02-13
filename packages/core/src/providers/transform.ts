/**
 * Provider Transform Layer
 *
 * Transforms messages, schemas, and options to handle provider-specific
 * quirks and optimizations. Each transformation exists because a specific
 * provider's API will reject or mishandle the default format.
 *
 * Transformations:
 * - Tool call ID normalization (Claude, Mistral require specific ID formats)
 * - Message sequencing fixes (Mistral rejects tool -> user adjacency)
 * - Unsupported modality filtering (prevents cryptic API 400s)
 * - Anthropic prompt caching (saves ~90% on cache hits)
 * - Gemini schema sanitization (integer enums, orphaned required fields)
 * - Provider-specific options (temperature, thinking, caching)
 * - Max output token calculation
 */

import type { ModelInfo } from '@coding-assistant/shared';

// ── Provider detection helpers ──────────────────────────────────────────

function isAnthropic(model: ModelInfo): boolean {
  return model.providerId === 'anthropic' || model.id.toLowerCase().includes('claude');
}

function isMistral(model: ModelInfo): boolean {
  return model.providerId === 'mistral' || model.id.toLowerCase().includes('mistral');
}

function isGoogle(model: ModelInfo): boolean {
  return model.providerId === 'google' || model.id.toLowerCase().includes('gemini');
}

function isOpenAI(model: ModelInfo): boolean {
  return model.providerId === 'openai';
}

function isOpenRouter(model: ModelInfo): boolean {
  return model.providerId === 'openrouter';
}

// ── Tool call ID normalization ──────────────────────────────────────────

/**
 * Anthropic requires tool call IDs to match [a-zA-Z0-9_-].
 * AI SDK can generate IDs with other characters, causing 400 Bad Request.
 */
function normalizeAnthropicToolCallId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Mistral requires tool call IDs to be exactly 9 alphanumeric characters.
 * We hash the original ID down to a stable 9-char string.
 */
function normalizeMistralToolCallId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  const positive = Math.abs(hash);
  return positive.toString(36).padStart(9, 'a').slice(0, 9);
}

/**
 * Normalize tool call IDs in a message array based on the target model.
 */
function normalizeToolCallIds<T extends { role: string; content?: unknown }>(
  messages: T[],
  model: ModelInfo,
): T[] {
  if (!isAnthropic(model) && !isMistral(model)) return messages;

  const normalize = isAnthropic(model)
    ? normalizeAnthropicToolCallId
    : normalizeMistralToolCallId;

  return messages.map((msg) => {
    if (!Array.isArray(msg.content)) return msg;

    const content = msg.content.map((part: Record<string, unknown>) => {
      if (part.type === 'tool-call' && typeof part.toolCallId === 'string') {
        return { ...part, toolCallId: normalize(part.toolCallId as string) };
      }
      if (part.type === 'tool-result' && typeof part.toolCallId === 'string') {
        return { ...part, toolCallId: normalize(part.toolCallId as string) };
      }
      return part;
    });

    return { ...msg, content };
  });
}

// ── Message sequencing fixes ────────────────────────────────────────────

/**
 * Mistral rejects `tool -> user` message sequences without an intermediate
 * assistant message. We insert a synthetic `assistant: "Done."` between them.
 */
function fixMessageSequencing<T extends { role: string }>(
  messages: T[],
  model: ModelInfo,
): T[] {
  if (!isMistral(model)) return messages;

  const fixed: T[] = [];
  for (let i = 0; i < messages.length; i++) {
    fixed.push(messages[i]);

    if (
      messages[i].role === 'tool' &&
      i + 1 < messages.length &&
      messages[i + 1].role === 'user'
    ) {
      // Insert synthetic assistant message
      fixed.push({ role: 'assistant', content: 'Done.' } as T);
    }
  }
  return fixed;
}

// ── Unsupported modality filtering ──────────────────────────────────────

/**
 * Before sending to the API, check model capabilities and replace
 * unsupported content types with a plain-text error message.
 *
 * This prevents cryptic API errors and lets the model inform the user
 * in natural language.
 */
function filterUnsupportedModalities<T extends { role: string; content?: unknown }>(
  messages: T[],
  model: ModelInfo,
): T[] {
  const inputCaps = model.capabilities.input;

  return messages.map((msg) => {
    if (!Array.isArray(msg.content)) return msg;

    const content = msg.content.map((part: Record<string, unknown>) => {
      if (part.type === 'image' && !inputCaps.image) {
        return {
          type: 'text',
          text: 'ERROR: Cannot read image (this model does not support image input). Inform the user.',
        };
      }
      if (part.type === 'audio' && !inputCaps.audio) {
        return {
          type: 'text',
          text: 'ERROR: Cannot process audio (this model does not support audio input). Inform the user.',
        };
      }
      if (part.type === 'file' && part.mimeType === 'application/pdf' && !inputCaps.pdf) {
        return {
          type: 'text',
          text: 'ERROR: Cannot read PDF (this model does not support PDF input). Inform the user.',
        };
      }
      return part;
    });

    return { ...msg, content };
  });
}

// ── Anthropic prompt caching ────────────────────────────────────────────

/**
 * Adds `cacheControl: { type: "ephemeral" }` to system messages and the
 * last 2 user messages. This enables Anthropic's prompt caching, which
 * saves ~90% on cache hits (cache_read is 10x cheaper than input).
 */
function applyAnthropicCaching<T extends { role: string; content?: unknown }>(
  messages: T[],
): T[] {
  const result = [...messages];

  // Tag system messages with cache control
  for (let i = 0; i < result.length; i++) {
    if (result[i].role === 'system') {
      result[i] = {
        ...result[i],
        providerMetadata: { anthropic: { cacheControl: { type: 'ephemeral' } } },
      } as T;
    }
  }

  // Tag last 2 user messages with cache control
  let userCount = 0;
  for (let i = result.length - 1; i >= 0 && userCount < 2; i--) {
    if (result[i].role === 'user') {
      result[i] = {
        ...result[i],
        providerMetadata: { anthropic: { cacheControl: { type: 'ephemeral' } } },
      } as T;
      userCount++;
    }
  }

  return result;
}

// ── Gemini schema sanitization ──────────────────────────────────────────

/**
 * Sanitize JSON schemas for Gemini compatibility.
 *
 * Gemini's API has strict JSON Schema limitations:
 * - Does NOT support integer enums -> convert to string enums
 * - Requires `items` on array types (even if empty)
 * - Rejects orphaned `required` entries not in `properties`
 */
export function sanitizeSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
  if (typeof schema !== 'object' || schema === null) return schema;

  const result = { ...schema };

  // Convert integer enums to string enums
  if (result.type === 'integer' && Array.isArray(result.enum)) {
    result.type = 'string';
    result.enum = (result.enum as unknown[]).map(String);
  }

  // Ensure arrays have items
  if (result.type === 'array' && !result.items) {
    result.items = {};
  }

  // Recursively sanitize nested schemas
  if (result.items && typeof result.items === 'object') {
    result.items = sanitizeSchemaForGemini(result.items as Record<string, unknown>);
  }

  if (result.properties && typeof result.properties === 'object') {
    const props = result.properties as Record<string, Record<string, unknown>>;
    const sanitizedProps: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      sanitizedProps[key] = sanitizeSchemaForGemini(value);
    }
    result.properties = sanitizedProps;

    // Filter required to only include fields that exist in properties
    if (Array.isArray(result.required)) {
      result.required = (result.required as string[]).filter(
        (field) => field in sanitizedProps,
      );
    }
  }

  // Handle oneOf, anyOf, allOf
  for (const combiner of ['oneOf', 'anyOf', 'allOf'] as const) {
    if (Array.isArray(result[combiner])) {
      result[combiner] = (result[combiner] as Record<string, unknown>[]).map(
        sanitizeSchemaForGemini,
      );
    }
  }

  return result;
}

// ── Provider-specific options ───────────────────────────────────────────

/**
 * Get the optimal temperature for a model.
 *
 * Some models work best with specific temperature values:
 * - Claude: undefined (let the API use its default)
 * - Gemini reasoning models: 1.0 (required for thinking)
 * - QwQ/Qwen reasoning: 0.55 (their recommended value)
 * - Others: undefined (use API default)
 */
export function getTemperature(model: ModelInfo): number | undefined {
  const id = model.id.toLowerCase();

  // Claude works best with API default
  if (isAnthropic(model)) return undefined;

  // Gemini reasoning models need temperature=1
  if (isGoogle(model) && model.capabilities.reasoning) return 1.0;

  // Qwen reasoning models
  if (id.includes('qwq') || (id.includes('qwen') && model.capabilities.reasoning)) {
    return 0.55;
  }

  // Default: let the API decide
  return undefined;
}

/**
 * Build provider-specific options for the streamText() call.
 *
 * These are injected as `providerOptions` in AI SDK v6 and configure
 * provider-specific features that don't have a standard API surface.
 */
export function getProviderOptions(
  model: ModelInfo,
  sessionId: string,
): Record<string, Record<string, unknown>> {
  const options: Record<string, Record<string, unknown>> = {};

  if (isGoogle(model)) {
    // Enable thinking output for reasoning models
    if (model.capabilities.reasoning) {
      options.google = { thinkingConfig: { includeThoughts: true } };
    }
  }

  if (isOpenAI(model)) {
    // Enable prompt caching across requests in the same session
    options.openai = { promptCacheKey: sessionId };
  }

  if (isOpenRouter(model)) {
    // Request usage/token counts (not returned by default)
    options.openrouter = { usage: { include: true } };
  }

  return options;
}

// ── Max output tokens ───────────────────────────────────────────────────

/**
 * Calculate the appropriate maxOutputTokens for a model.
 *
 * Uses the model's reported limit, capped at a reasonable global max
 * to prevent runaway costs on models with very large limits.
 */
export function getMaxOutputTokens(model: ModelInfo): number {
  const GLOBAL_MAX = 32_000;
  const modelLimit = model.limits.maxOutput;
  return Math.min(modelLimit, GLOBAL_MAX);
}

// ── Main transform pipeline ─────────────────────────────────────────────

/**
 * Transform messages through the full provider-specific pipeline.
 *
 * Applied before sending to the AI provider. Each transformation is
 * conditional on the target model's provider and capabilities.
 */
export function transformMessages<T extends { role: string; content?: unknown }>(
  messages: T[],
  model: ModelInfo,
): T[] {
  let result = messages;

  // Filter unsupported modalities (all providers)
  result = filterUnsupportedModalities(result, model);

  // Normalize tool call IDs (Claude, Mistral)
  result = normalizeToolCallIds(result, model);

  // Fix message sequencing (Mistral)
  result = fixMessageSequencing(result, model);

  // Apply prompt caching (Anthropic)
  if (isAnthropic(model)) {
    result = applyAnthropicCaching(result);
  }

  return result;
}
